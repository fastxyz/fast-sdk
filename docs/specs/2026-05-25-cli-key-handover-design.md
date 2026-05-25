# fast-cli — agent-side key handover (`fast authorize`) — 设计

> 状态：设计已与用户确认主线，待 spec 评审 → 进入实现计划。
> 上游 SDK 协议：`@fastxyz/sdk/wallet`（`KeyHandoverAgent`、`parseAuthRequest` / `sealHandover`，已在 origin/develop 合并 — PR #99）。
> 本文档为 fast-cli **agent 端**两条命令的设计，外加为支持"跨 CLI 进程持久化挂起态"所需的 SDK 扩展。

## 1. 背景与目标

`@fastxyz/sdk/wallet` 已提供完整的 HPKE 私钥移交协议。fast-cli 想暴露 **agent 端**两条命令：

- `fast authorize request` — 生成一次性 HPKE 公钥 + auth_url（给源钱包用户用）
- `fast authorize complete` — 用源钱包返回的 handover code 解出 32 字节 Ed25519 seed，hex 打印到 stdout

典型使用场景：用户在 fast-app 网页钱包里有账户，想把它的私钥**安全地**导出到本地——通过加密 handover 协议传输（而不是裸 hex 复制粘贴）。fast-cli 在这个流程里扮演 agent 角色。

## 2. 关键约束（必须先理解）

SDK 的 `KeyHandoverAgent` 设计为**单进程单实例**：

- `generateAuthRequest` 产生一次性 HPKE 私钥，只存活在 `KeyHandoverAgent` 实例的内存里。
- `decryptAuthPayload` 必须在**同一个 agent 实例**上调用，因为它要用那把私钥 + 当时的请求字节（作 HPKE AAD）。
- skill 原话："Never run generate in one node invocation and decrypt in another."

但 CLI 两条命令 = 两次独立的 `node` 进程，所以**必须做挂起态持久化**才能让 `complete` 接住 `request` 留下的状态。

**选定方案：扩 SDK 加 `exportPending` / `restore`，CLI 负责落盘**。理由：
- SDK 自己掌握序列化格式与解析，避免 CLI 依赖 SDK 内部模块（如 `dist/wallet/key-handover/crypto/hpke.js`）的脆耦合。
- 其他将来的 CLI / agent runtime 也能复用相同的持久化能力。

## 3. 范围

**In scope：**

- SDK：在 `KeyHandoverAgent` 上加 `exportPending()` 实例方法 + `restore()` 静态方法 + `SerializedPending` 类型；从 `@fastxyz/sdk/wallet` 导出。
- SDK：让 `generateKeyPair`（`crypto/hpke.ts`）产生**可导出**的 X25519 私钥（`extractable: true`）；这是 `exportPending` 的前置条件。
- CLI：新建 `app/cli/src/commands/authorize/` 命令组，含 `request.ts` 与 `complete.ts`。
- CLI：状态文件 `~/.fast/handover-pending.json`（0600）；单 pending 模型。
- 测试：SDK 端 `exportPending → restore` 后能 round-trip `decryptAuthPayload`；CLI 端 happy-path + 错误 path。

**Out of scope：**

- 钱包端命令（`parseAuthRequest` / `sealHandover`）——本轮不做；未来若 fast-cli 想做钱包侧授权再单独立项。
- 持久化加密（state 文件内容明文 JSON；HPKE 私钥本身落盘已是安全权衡，见 §10）。
- 多 pending 并发（沿用 SDK 的"单 pending"约束）。
- 把解出的 seed 自动 import 到 fast-cli keystore（用户选了"默认打印到 stdout"；将来想加 `--import-as NAME` 再说）。
- agent-side 长进程模型 / daemon / IPC——明确不走这条路。

## 4. SDK 扩展（`packages/fast-sdk/src/wallet/key-handover/`）

### 4.1 `SerializedPending` 类型（新增 `agent.ts`）

```ts
export interface SerializedPending {
  v: 1;                         // schema 版本
  hpke_private_key_jwk: JsonWebKey;  // X25519 私钥 JWK（kty:"OKP", crv:"X25519")
  request_payload: string;      // base64url(原始请求 JSON 字节，作 HPKE AAD)
  fingerprint: string;          // "123456" 6-digit numeric string
  expires_at: string;           // ISO "YYYY-MM-DDTHH:mm:ssZ"
  failure_count: number;        // 0..3
}
```

**为什么选 JWK 不选 raw / pkcs8：**
- `crypto.subtle.exportKey('raw', ...)` 对 X25519 私钥的支持在各浏览器/Node 之间不一致。
- `'jwk'` 是 X25519 私钥跨平台导出的最稳定格式（`{ kty: "OKP", crv: "X25519", d, x }`），Node ≥ 20 与 WebCrypto 都稳定支持。
- 落盘体积可接受（百字节级，对单 pending 不是负担）。

### 4.2 `crypto/hpke.ts` 修改

让 `generateKeyPair()` 产生 `extractable: true` 的私钥：

当前实现 `await suite().kem.generateKeyPair()` 走 `@hpke/core` 的 `DhkemX25519HkdfSha256.generateKeyPair()`，默认 non-extractable，无法 `exportKey('jwk', ...)`。

改为直接走 WebCrypto：

```ts
const kp = (await crypto.subtle.generateKey(
  { name: "X25519" },
  true,                     // extractable
  ["deriveBits"],
)) as CryptoKeyPair;
return { publicKey: kp.publicKey, privateKey: kp.privateKey };
```

`@hpke/core` 的 `hpkeOpen` 直接接 `recipientPrivateKey: CryptoKey` 喂给 `s.createRecipientContext({ recipientKey, enc, info })`——只要 CryptoKey 是 X25519 私钥就行，**不需要中间 `kem.importKey` 转换**。`exportRecipientPublicKey` 走 `s.kem.serializePublicKey(publicKey)`，对外部生成的 X25519 公钥同样工作。

**环境要求：** Node ≥ 20（X25519 在 WebCrypto 中稳定支持）、所有现代浏览器。fast-sdk 当前 `engines` 字段需在实现时核对；若未声明，本改动一并补 `"engines": { "node": ">=20" }`。

**对现有调用方的影响：** `generateKeyPair` 的签名 / 返回类型不变；唯一差异是底层私钥现在 extractable。`KeyHandoverAgent` 既有行为不变，额外多了被 `exportPending()` 导出的能力。

### 4.3 `KeyHandoverAgent.exportPending()` 实例方法

```ts
async exportPending(): Promise<SerializedPending | null>
```

行为：
- 若无 pending（`this.currentKeyPair === null` 或 `this.pending.peek() === null`）→ 返回 `null`
- 否则：
  - `jwk = await crypto.subtle.exportKey("jwk", this.currentKeyPair.privateKey)`
  - 读 `PendingStore` 内部记录（需要 `PendingStore` 暴露 `peek()` 已有；额外需要读 `failureCount`，需要 `peek()` 返回完整 record 或加 getter）
  - 组装 `SerializedPending` 返回
- 错误：导出失败 → throw（不是 result envelope；属于编程/环境错误）

> 实现注意：`PendingStore.peek()` 返回 `PendingRecord | null`，`PendingRecord` 已包含 `failureCount`（见 `state/pending.ts:10–13`）。`exportPending` 直接读即可，不需要扩 `peek` 签名。

### 4.4 `KeyHandoverAgent.restore()` 静态方法

```ts
static async restore(
  state: SerializedPending,
  opts?: KeyHandoverAgentOptions
): Promise<KeyHandoverAgent>
```

行为：
- 校验 `state.v === 1`，否则 throw "unsupported serialized pending version"
- `privateKey = await crypto.subtle.importKey("jwk", state.hpke_private_key_jwk, { name: "X25519" }, true, ["deriveBits"])`
  - 派生 publicKey：`publicKey = await crypto.subtle.importKey("jwk", { kty: state.hpke_private_key_jwk.kty, crv: state.hpke_private_key_jwk.crv, x: state.hpke_private_key_jwk.x }, ...)`
  - （或直接从 JWK 私钥里读 `x` 字段构出公钥 JWK）
- `requestPayloadBytes = base64UrlDecode(state.request_payload)`
- `new KeyHandoverAgent(opts)`，然后注入 pending 记录：`agent.currentKeyPair = { publicKey, privateKey }`；`agent.pending.setRecord({ hpkePrivateKey: privateKey, requestPayloadBytes, fingerprint: state.fingerprint, expiresAt: state.expires_at, failureCount: state.failure_count })`
- 返回 agent

**新增 `PendingStore.setRecord(record)` 内部方法**（不暴露到包 API；仅 `agent.ts` 同模块内访问）：用来从外部装入完整 pending 状态（包含 `failureCount`），与 `set()` 的"new pending, failureCount=0"语义区分。

### 4.5 `@fastxyz/sdk/wallet` 导出更新

在 `packages/fast-sdk/src/wallet/index.ts` 增加：

```ts
export type { SerializedPending } from "./key-handover/agent";
// KeyHandoverAgent 已导出，新加的 exportPending / restore 自动可达
```

### 4.6 `agent.ts` 错误码透传修复

上游 SDK 把 pre-pending 阶段的错误（`extractSingleQuotedCandidate` / `decodeHandoverCode` 抛出的）统统写死成 `MALFORMED_HANDOVER_MESSAGE`：

```ts
// agent.ts:75–80 现状
try {
  const code = extractSingleQuotedCandidate(input.message);
  payload = decodeHandoverCode(code);
} catch (err) {
  return error(ERROR.MALFORMED_HANDOVER_MESSAGE, err);  // ← 写死，丢失 INVALID_HANDOVER_CODE
}
```

`decodeHandoverCode` 实际抛出的 Error 带 `INVALID_HANDOVER_CODE:` 前缀（见 `protocol/handover.ts:39/45/53/56/62/66/71/75`），但被外层 catch 覆盖。CLI / 上游消费方因此无法区分"消息根本不像 handover code"和"handover code 自身格式错"。

**修法**：把既有的 `errorFromMessage` helper（`agent.ts:126–130`）加一个 `fallback` 参数，pre-pending catch 改用它：

```ts
function errorFromMessage(
  cause: unknown,
  fallback: string = ERROR.MISSING_PENDING_REQUEST,
): DecryptResult {
  const message = messageOf(cause);
  const code = message.split(":")[0]?.trim() || fallback;
  return { status: "error", error: { code, message } };
}

// 调用处
try {
  const code = extractSingleQuotedCandidate(input.message);
  payload = decodeHandoverCode(code);
} catch (err) {
  return errorFromMessage(err, ERROR.MALFORMED_HANDOVER_MESSAGE);
}
```

`beginConsuming` 那个 catch 继续用默认 fallback（`MISSING_PENDING_REQUEST`），保持原行为。

### 4.7 SDK 测试

新增 `tests/persistence.test.ts`（落位按 `@fastxyz/sdk` 既有测试约定，plan 阶段对齐）：

- `exportPending` returns null when no pending
- `generate → export → restore → decrypt` round-trip 与"不 export/restore 直接 decrypt"等价
- `exportPending` 幂等（连调两次结果相同）
- `restore({...v: 2 as any})` throws unsupported version
- `restore` 后篡改的 handover code 仍走 `recordFailure`（前 2 次保留 pending）
- `restore` 后连续 3 次失败 SDK 内部 pending 清空
- §4.6 修复后：bare base64url 但 JSON 错 → `code === "INVALID_HANDOVER_CODE"`
- §4.6 修复后：纯文本无引号 → `code === "MALFORMED_HANDOVER_MESSAGE"`

## 5. CLI 命令设计

### 5.1 命令树

```
fast authorize
  ├── request   [--requester NAME] [--json]
  └── complete  [--message TEXT | --stdin] [--print-account] [--json]
```

### 5.2 `fast authorize request`

**Parser**（`app/cli/src/cli.ts` 加）：

```ts
const authorizeRequestParser = command(
  "request",
  object({
    cmd: constant("authorize-request" as const),
    requester: optional(
      option("--requester", string({ metavar: "NAME" }), {
        description: message`Free-text label shown to the wallet user`,
      }),
    ),
  }),
  { description: message`Generate an authorization request URL for an account handover` },
);
```

**Handler**（`app/cli/src/commands/authorize/request.ts`）：

1. 计算状态文件路径：`${process.env.HOME ?? "~"}/.fast/handover-pending.json`（沿用 `main.ts:440` 的 `~/.fast/` 风格）。
2. 若文件存在：
   - 读出 `SerializedPending`；若 `expires_at > now` → 报错 `"Already have a pending authorization request (fingerprint X, expires Y). Run 'fast authorize complete' to finish it, or wait until it expires."`，**不覆盖**（避免误丢未完成的请求）。
   - 若已过期 → 直接删旧文件，继续。
3. `new KeyHandoverAgent()` → `await agent.generateAuthRequest({ requester })`
4. `state = await agent.exportPending()`（必非 null）
5. 写文件：先 `fs.mkdir(dir, { recursive: true })`，再 `fs.writeFile(path, JSON.stringify(state), { mode: 0o600 })`。原子性：写 `path + ".tmp"` → `fs.rename` 到 `path`。
6. 输出：

人模式（默认）：
```
Authorization URL:
  https://app.fast.xyz/authorize?data=eyJ...

Fingerprint:    123456
Expires at:     2026-05-25T12:05:00Z

Show the URL to the wallet user. Once they paste back the handover
code, run:
  fast authorize complete --message '<paste here>'
```

JSON 模式（`--json`）：
```json
{
  "auth_url": "https://app.fast.xyz/authorize?data=...",
  "request_fingerprint": "123456",
  "request_expires_at": "2026-05-25T12:05:00Z"
}
```

**错误模型：** 上述步骤 2 中"已有未过期 pending"的情况返回 `ClientError`（沿用 CLI 现有错误类型）；fs 错误（如权限不足）也包装成 `ClientError`。

### 5.3 `fast authorize complete`

**Parser**：

```ts
const authorizeCompleteParser = command(
  "complete",
  object({
    cmd: constant("authorize-complete" as const),
    message: optional(
      option("--message", string({ metavar: "TEXT" }), {
        description: message`Handover code or chat message containing it`,
      }),
    ),
    stdin: withDefault(
      option("--stdin", {
        description: message`Read handover code from stdin instead of an argument`,
      }),
      false,
    ),
    printAccount: withDefault(
      option("--print-account", {
        description: message`Also print the derived Fast address and public key`,
      }),
      false,
    ),
  }),
  { description: message`Decrypt a pasted handover code and print the private key` },
);
```

**Handler**（`app/cli/src/commands/authorize/complete.ts`）：

1. 读 `~/.fast/handover-pending.json`，不存在 → 报错 `"No pending authorization request. Run 'fast authorize request' first."`
2. JSON.parse → `state: SerializedPending`；校验失败（字段缺失 / `v !== 1`）→ 报错 `"Corrupt pending state file. Delete ~/.fast/handover-pending.json and run 'request' again."`
3. `agent = await KeyHandoverAgent.restore(state)`
4. 取 handover code，按优先级：
   - `--message TEXT` 直接用
   - `--stdin` 从 `process.stdin` 读到 EOF
   - 否则交互 prompt（用 CLI 现有 prompt 工具；若 `--non-interactive` 且都没给 → 报错"missing handover code"）
5. `result = await agent.decryptAuthPayload({ message })`
6. 分支：
   - **success**：
     - 在内存里派生 address + public_key（仅当 `--print-account`）；任何派生失败 → **不**删 pending 文件，报错（让用户能再跑一次 `complete` 用同样的 handover code 重试）
     - 组装人模式 / JSON 输出 → 写 stdout → 等 flush（如 `await new Promise<void>(r => process.stdout.write("", () => r()))`，或显式 cork/uncork）
     - **flush 成功后**才 `fs.unlink(path)`；unlink 自身失败仅 warn 不 fail（key 已经成功输出，留下的文件下次 `request` 会处理）
   - **error**，`result.error.code === "DECRYPTION_FAILED"`（前 2 次解密失败）：
     - `updated = await agent.exportPending()` —— 若非 null（SDK 还保留 pending），原子写回文件
     - 若为 null（SDK 内部已删——刚好碰上第 3 次失败的状态机切换）→ 删本地文件
     - 报错码 + message
   - **error**，`code` ∈ {`TOO_MANY_FAILURES`, `REQUEST_EXPIRED`, `MISSING_PENDING_REQUEST`, `STORAGE_FAILED`}：
     - 删本地 pending 文件
     - 报错
   - **error**，`code` ∈ {`MALFORMED_HANDOVER_MESSAGE`, `INVALID_HANDOVER_CODE`}（pre-pending 阶段；§4.6 修后两者可区分）：
     - **不删**本地文件、**不更新** failure_count（SDK 也没消耗失败计数）
     - 报错让用户重 paste

7. 成功输出：

人模式（默认 `--print-account=false`）：
```
0x1313131313131313131313131313131313131313131313131313131313131313
```
（裸 hex 一行，stdout，便于 `$(fast authorize complete ...)` 之类的脚本管道）

人模式（`--print-account`）：
```
Private key:     0x1313...
Address:         fast1abc...xyz
Public key:      0xdead...beef
```

JSON 模式（`--json`，默认）：
```json
{ "private_key": "0x1313..." }
```

JSON 模式（`--json --print-account`）：
```json
{
  "private_key": "0x1313...",
  "address": "fast1...",
  "public_key": "0x..."
}
```

> **Address / public key 推导：** 调 `new Signer(seedBytes).getFastAddress() / .getPublicKey()`（`@fastxyz/sdk` 已导出 `Signer`，CLI 现有 account 命令也是这么用的）。

### 5.4 命令注册

`app/cli/src/cli.ts`：

```ts
const authorizeGroup = command(
  "authorize",
  or(authorizeRequestParser, authorizeCompleteParser),
  { description: message`Agent-side key handover protocol` },
);

// 在 commands union 加 authorizeGroup
const commands = or(accountGroup, networkGroup, infoGroup, sendParser, fundGroup, payParser, authorizeGroup);

// 导出类型
export type AuthorizeRequestArgs = InferValue<typeof authorizeRequestParser>;
export type AuthorizeCompleteArgs = InferValue<typeof authorizeCompleteParser>;
```

`app/cli/src/commands/index.ts`：

```ts
import { authorizeComplete } from "./authorize/complete.js";
import { authorizeRequest } from "./authorize/request.js";

export const commands = [
  // ...既有,
  authorizeRequest,
  authorizeComplete,
];
```

`main.ts` 的 switch dispatch 增加 `case "authorize-request"` / `"authorize-complete"` 调对应 handler。

## 6. 状态文件

- **路径**：`~/.fast/handover-pending.json`（沿用现有 `~/.fast/` 风格，对应 `app/cli/src/main.ts:440` 的 `~/.fast/fast.db`）。
- **mode**：0600（仅 owner 可读写）。
- **格式**：`SerializedPending` 的 JSON 序列化（包括 `hpke_private_key_jwk` 整段 JWK 对象）。
- **生命周期**：
  - `request` 写入；
  - `complete` 成功 → 删；
  - `complete` 失败前 2 次 → 更新失败计数后写回（原子 `write tmp → rename`）；
  - `complete` 失败第 3 次 / TOO_MANY_FAILURES / REQUEST_EXPIRED / MISSING → 删；
  - `request` 再次执行且检测到旧文件已过期 → 删旧后写新；未过期 → 拒绝并保留旧的。
- **单 pending**：与 SDK 行为一致；不支持并发多请求。
- **不支持的场景**：
  - **同机并发**：两个 `fast authorize request` 同时跑可能彼此覆盖 state 文件，HPKE 私钥泄露第一个。设计假设"单用户单 invocation"，不做 `O_EXCL` 加锁。
  - **跨机器**：state 文件仅本机有效；`request` 在 A 机跑、`complete` 在 B 机跑无法接力。

## 7. 用户输入信道（`complete` 拿 handover code）

按优先级：

1. `--message TEXT`：直接用。**接受两种格式**（SDK `extractSingleQuotedCandidate` 自动识别，见 `protocol/handover.ts:13–14`）：
   - 裸 handover code（base64url，纯字符 `[A-Za-z0-9_-]+`）
   - 整段聊天消息（任意文本含**恰好一对**双引号包裹的 code，例如 SDK `sealHandover` 产出的 `Here is the encrypted handover code...: "..."`）
2. `--stdin`：从 stdin 读到 EOF，同样接受两种格式（透传 SDK）。适合 `cat code.txt | fast authorize complete --stdin`。
3. 交互 prompt：复用 CLI 现有 `Prompt` Effect service（`app/cli/src/services/prompt.ts`，已被 `account/create.ts` / `send.ts` / `pay.ts` 用作 `password` / `confirm`）。**前置确认**：该 service 是否已有 `input(label)` 方法——
   - 有 → 直接用
   - 无 → 在该 service 加 `input(opts: { label: string }): Effect<string, IoError>`，基于既有 `password` 实现裁剪掉 echo 掩码即可
4. 若 `--non-interactive` 且上面都没给 → 抛 `MissingHandoverMessageError`（见 §8）。

> **不读环境变量 / 不读 argv 默认值**：避免 ps / shell history 泄露。

## 8. 错误处理

CLI 用 **typed Effect error classes**（见 `app/cli/src/errors/index.ts` 的 `AccountExistsError` / `FileIOError` / `InvalidAmountError` 等先例），不用裸字符串 code。

**新增 `app/cli/src/errors/key-handover.ts`**，加进 `errors/index.ts` 的 re-export 列表：

```ts
import { Data } from "effect";
import type { ErrorCode as SdkKeyHandoverErrorCode } from "@fastxyz/sdk/wallet";

/** Pending state file already exists and is not yet expired. */
export class PendingAlreadyExistsError extends Data.TaggedError(
  "PendingAlreadyExistsError",
)<{ fingerprint: string; expiresAt: string }> {}

/** No pending state file — user needs to run `request` first. */
export class NoPendingRequestError extends Data.TaggedError(
  "NoPendingRequestError",
)<{}> {}

/** Pending state file unreadable / malformed / wrong schema version. */
export class CorruptPendingStateError extends Data.TaggedError(
  "CorruptPendingStateError",
)<{ reason: string }> {}

/** `complete` invoked without --message / --stdin and not interactive. */
export class MissingHandoverMessageError extends Data.TaggedError(
  "MissingHandoverMessageError",
)<{}> {}

/**
 * SDK `decryptAuthPayload` returned `{status: "error"}`. Wraps the SDK's
 * string code so handlers can match on `sdkCode` for branching
 * (e.g., on `TOO_MANY_FAILURES` to also unlink the state file).
 */
export class KeyHandoverProtocolError extends Data.TaggedError(
  "KeyHandoverProtocolError",
)<{ sdkCode: SdkKeyHandoverErrorCode; message: string }> {}
```

**渲染规则**（沿用 CLI 既有 error render policy；如有 helper 复用，无则按现有 error class 的渲染风格添加）：
- 人模式：友好 message 到 stderr，process exit code 非 0
- `--json`：`{ "error": { "tag": "<TaggedError tag>", ...其余字段 } }` 到 stdout

**SDK `result.error.code` → CLI 行为映射**（在 `complete.ts` 的 result 分支里实现，对应 §5.3 step 6）：

| SDK `code` | CLI 行为 |
|---|---|
| `MALFORMED_HANDOVER_MESSAGE` / `INVALID_HANDOVER_CODE` | 不动 state 文件，wrap 成 `KeyHandoverProtocolError` 抛出 |
| `MISSING_PENDING_REQUEST` / `REQUEST_EXPIRED` / `REQUEST_NOT_PENDING` | 删本地 state 文件，wrap 抛出 |
| `DECRYPTION_FAILED` | 重新 `exportPending()` 得新状态（`failure_count++`），原子写回；wrap 抛出 |
| `TOO_MANY_FAILURES` / `STORAGE_FAILED` | 删本地 state 文件，wrap 抛出 |

> 本映射的"`MALFORMED_HANDOVER_MESSAGE` vs `INVALID_HANDOVER_CODE` 真能区分"前提**生效于 §4.6 SDK 修复**——否则 pre-pending 错误统一是 `MALFORMED_HANDOVER_MESSAGE`，区分行变成同一列。

## 9. 测试

### 9.1 SDK（vitest）

- 见 §4.7。

### 9.2 CLI（vitest）

新建 `app/cli/tests/commands/authorize/`：

- **happy path**：`request` 后状态文件存在 → mock 一个合法 handover code → `complete --message` 成功打印 private key → 文件删除。
- **error: no pending**：`complete` 在文件不存在时抛 `NoPendingRequestError`。
- **error: already pending**：`request` 在文件存在且未过期时抛 `PendingAlreadyExistsError`，**不动**旧文件。
- **error: expired pending**：`request` 在文件存在但已过期时，删旧后写新，stderr 含 `previous pending request ... expired ... replaced` 提示。
- **error: corrupt state file**：`complete` 在文件存在但 JSON / schema 错时抛 `CorruptPendingStateError`。
- **error: decryption fail < 3 次**：`complete` 拿一个对错公钥加密的合法 handover code → 抛 `KeyHandoverProtocolError({ sdkCode: "DECRYPTION_FAILED" })` → 本地文件被更新（`failure_count++`）。
- **error: decryption fail = 3 次**：连续 3 次 → 第 3 次 `sdkCode === "TOO_MANY_FAILURES"` → 本地文件被删。
- **error: malformed paste**：`sdkCode === "MALFORMED_HANDOVER_MESSAGE"` → 文件**不动**。
- **error: invalid handover code**（§4.6 修复后）：合法 base64url 但 JSON 错 → `sdkCode === "INVALID_HANDOVER_CODE"` → 文件**不动**。
- **input: --stdin**：通过 stdin pipe 一个合法 code → 同 happy path。
- **input: --message 接受裸 code 与带引号消息**：两种格式各一条用例。
- **input: --non-interactive 无来源**：抛 `MissingHandoverMessageError`。
- **mode: --json**：成功与失败的 JSON 输出 schema 正确（含 `{ "error": { "tag": "...", ... } }` 形态）。
- **mode: --print-account**：成功输出含 `address` / `public_key`，且与 `new Signer(seed)` 派生一致。
- **state file mode**：写入后 `fs.stat` 验证 mode 是 0600。
- **success ordering**：`Signer.getFastAddress` mock 成 throw → state 文件**保留**、stdout 无半成品输出、错误抛出；用户能重 paste 重试。

测试里用临时目录覆盖 `HOME`（`process.env.HOME = tmpDir`）避免污染真实 `~/.fast/`。

## 10. 安全权衡（写进 CLI `request` 命令的 `--help` description 与 README）

**威胁模型：** 攻击者拿到 `~/.fast/handover-pending.json` 的内容。

- 文件里有什么？X25519 **HPKE 一次性私钥**（JWK 格式）+ 请求字节 + fingerprint + 过期时间 + 失败计数。**没有** ed25519 seed 本身。
- 攻击者用这把 HPKE 私钥能干什么？**仅当**他还**截获了源钱包用户传回来的 handover code**（同时窃听两条不同信道：本地文件系统 + 用户的聊天 paste 通道），他才能解出 seed。
- 单独偷文件 → 完全无用。
- 文件最长存活 ≤ 5 分钟（HPKE 请求 TTL）；成功 / 3 次失败 / 过期均擦。
- 0600 权限阻挡同机其他用户。

**对比：** 比起"把解出的 seed 落盘"——后者只要偷到文件就拿到永久私钥——本设计安全得多。比起纯内存"单进程"模型——本设计弱一档，换来 CLI 可拆两条命令。

**用户提示：** `request` 命令的人模式输出末尾打一行 `Note: a short-lived authorization key is stored at ~/.fast/handover-pending.json (mode 0600) for up to 5 minutes.`

**侧信道：** state 文件每次失败都被原子重写，mtime 变化暴露失败次数 / 用户活动节奏。同机有读权限的攻击者可推断 handover 尝试节奏。**不缓解**——CLI 单用户场景下成本不值。

## 11. 实现顺序（写 plan 时按这个顺序展开）

1. SDK：`crypto/hpke.ts` 让 `generateKeyPair` 产 extractable key（§4.2）；既有测试不破。
2. SDK：`PendingStore` 加 `setRecord(record)` 内部方法（同 module 可见，不导出包 API；§4.4 restore 用）；`peek()` 已返回完整 `PendingRecord` 不动签名（§4.3）。
3. SDK：`KeyHandoverAgent.exportPending()` 实现 + 测试（§4.3）。
4. SDK：`KeyHandoverAgent.restore()` 静态方法实现 + 测试（含 round-trip；§4.4）。
5. SDK：`agent.ts` 加 `errorFromMessage` 的 `fallback` 参数 + pre-pending catch 改调它（§4.6）；测试覆盖 INVALID_HANDOVER_CODE vs MALFORMED_HANDOVER_MESSAGE 区分。
6. SDK：`wallet/index.ts` 导出 `SerializedPending` 类型（§4.5）。
7. SDK：`tests/persistence.test.ts` 集中验收 §4.7 全列表（步骤 3/4/5 写入的测试若已分散，这步合并 / 补齐缺项）。
8. SDK：`pnpm --filter @fastxyz/sdk build` + `test` 全绿。
9. CLI：`app/cli/src/errors/key-handover.ts` 新建 5 个 TaggedError class（§8）；`errors/index.ts` re-export。
10. CLI：`cli.ts` 加 parsers + 命令组；导出 `AuthorizeRequestArgs` / `AuthorizeCompleteArgs`；`commands/index.ts` 注册；`main.ts` switch 加 case。
11. CLI：（若 §7 prompt 需要 `input(label)` 方法且未存在）扩 `services/prompt.ts`。
12. CLI：`commands/authorize/request.ts` 实现 + 测试。
13. CLI：`commands/authorize/complete.ts` 实现 + 测试。
14. CLI：跨命令端到端测试覆盖 §9.2 全列表。
15. Lint / typecheck：`pnpm exec biome check`、`pnpm exec tsc --noEmit`。
16. 文档：CLI README 加 `authorize` 章节；`skills/key-handover/SKILL.md` 末尾加 "Or, if you're running fast-cli as your agent runtime, use `fast authorize request` then `fast authorize complete --message '...'` instead of writing your own `KeyHandoverAgent` glue."
17. Changesets：分别加两个
    - `.changeset/<slug>-sdk.md`：`@fastxyz/sdk` minor，"add `KeyHandoverAgent.exportPending()` / `restore()` for cross-process key handover; route `INVALID_HANDOVER_CODE` through decrypt result; make HPKE keypair extractable."
    - `.changeset/<slug>-cli.md`：CLI 包 minor，"add `fast authorize request` / `fast authorize complete` commands."
18. **向后兼容声明**：SDK 改动纯增量（新 exports + agent.ts 错误码字段修正——后者对依赖"具体 code 字符串"的下游算行为变更，但当前 SDK 没明文承诺这套 code，按 minor 处理）；CLI 改动纯增量（新命令组，不动既有命令）。

## 12. 已收口的小决策

- **`exportPending` 的 JWK 字段命名**：`hpke_private_key_jwk`，明示是 HPKE 一次性私钥不是账户私钥。
- **过期 pending 在 `request` 时**：删旧后写新，**打一行** `Note: previous pending request (fingerprint X) expired at Y, replaced.` 到 stderr 让用户感知。
- **`walletBaseUrl` 不随 `--network` 切换**：key handover 协议与具体 network 无关，SDK 默认 `https://app.fast.xyz/authorize` 适用全网络。如需覆盖留待真实需求出现再加 `--wallet-base-url` flag。

## 13. 留给 plan 阶段对齐的实现细节

- SDK `tests/persistence.test.ts` 落位（co-located 还是顶层 `tests/`），按 `@fastxyz/sdk` 既有测试约定。
- `Prompt` service 是否已有 `input(label)` 方法（见 §7），若无则加，加到 `app/cli/src/services/prompt.ts` 同层。
- fast-sdk `package.json` 的 `engines.node` 是否已声明 `>=20`（见 §4.2），若未声明则补。
