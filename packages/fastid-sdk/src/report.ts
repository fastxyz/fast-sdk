import {
  IndeterminateReportSubmissionError,
  InvalidReportError,
  LocalVerificationError,
  ReportBodyTooLargeError,
  ReportCiphertextTooLargeError,
  ReportConfigError,
  ReportRejectedError,
  ReportSealError,
  SigningError,
} from "./errors.js";
import type { IdNetworkConfig } from "./networks.js";
import {
  anonymousEnvelope,
  attributionMessage,
  formatReceivedHour,
  hourUnixSecs,
  HPKE_INFO,
  HPKE_SUITE,
  reportAad,
  sealToRecipients,
  signedEnvelope,
  type ReportRecipient,
  type WireEnvelope,
} from "./report-wire.js";
import type { Signer } from "./signer.js";
import { verifyStrict } from "./verify.js";

export const REPORT_BODY_LIMIT = 2 * 1024 * 1024;
export const REPORT_CIPHERTEXT_LIMIT = 64 * 1024;
export const REPORT_TEXT_MAX = 2_000;
const HPKE_AEAD_TAG_BYTES = 16;

export type ReportSeverity = "blocked" | "annoying" | "cosmetic";

export interface SubmitReportInput {
  area: string;
  whatHappened: string;
  whatExpected: string;
  severity: ReportSeverity;
  page: string;
  attribution: "anonymous" | "signed";
  connectionId?: string;
  viewport?: string;
  locale?: string;
  at?: Date;
}

export interface SubmitReportResult {
  status: "stored";
}

type ReportInputSnapshot = Omit<SubmitReportInput, "at"> & { at: Date };

interface ReportConfig {
  areas: string[];
  hpke: { suite: string; info: string };
  recipients: ReportRecipient[];
}

interface ReportServiceOptions {
  config: IdNetworkConfig;
  signer: Signer;
  fetchImpl: typeof fetch;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReportConfig(value: unknown): value is ReportConfig {
  if (!isObject(value) || !Array.isArray(value.areas) || !isObject(value.hpke)) {
    return false;
  }
  return (
    value.areas.every((area) => typeof area === "string") &&
    value.hpke.suite === HPKE_SUITE &&
    value.hpke.info === HPKE_INFO &&
    Array.isArray(value.recipients) &&
    value.recipients.length > 0 &&
    value.recipients.length <= 8 &&
    value.recipients.every(
      (recipient) =>
        isObject(recipient) &&
        typeof recipient.key_id === "string" &&
        recipient.key_id.length >= 1 &&
        recipient.key_id.length <= 64 &&
        /^[\x21-\x7e]+$/.test(recipient.key_id) &&
        typeof recipient.public_key === "string" &&
        /^[0-9a-f]{64}$/.test(recipient.public_key),
    )
  );
}

function codePoints(value: string): number {
  return [...value].length;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function snapshotReportInput(value: unknown): ReportInputSnapshot {
  const reason = "report input is malformed or exceeds protocol limits";
  if (!isObject(value)) throw new InvalidReportError(reason);

  let fields: Record<string, unknown>;
  try {
    fields = {
      area: value.area,
      whatHappened: value.whatHappened,
      whatExpected: value.whatExpected,
      severity: value.severity,
      page: value.page,
      attribution: value.attribution,
      connectionId: value.connectionId,
      viewport: value.viewport,
      locale: value.locale,
      at: value.at,
    };
  } catch {
    throw new InvalidReportError(reason);
  }

  const {
    area,
    whatHappened,
    whatExpected,
    severity,
    page,
    attribution,
    connectionId,
    viewport,
    locale,
    at,
  } = fields;
  if (
    typeof area !== "string" ||
    typeof whatHappened !== "string" ||
    typeof whatExpected !== "string" ||
    (severity !== "blocked" &&
      severity !== "annoying" &&
      severity !== "cosmetic") ||
    typeof page !== "string" ||
    (attribution !== "anonymous" && attribution !== "signed") ||
    !isOptionalString(connectionId) ||
    !isOptionalString(viewport) ||
    !isOptionalString(locale)
  ) {
    throw new InvalidReportError(reason);
  }

  let atMs: number;
  try {
    atMs =
      at === undefined
        ? Date.now()
        : at instanceof Date
          ? at.getTime()
          : Number.NaN;
  } catch {
    throw new InvalidReportError(reason);
  }
  if (
    !Number.isFinite(atMs) ||
    whatHappened.trim().length === 0 ||
    codePoints(whatHappened) > REPORT_TEXT_MAX ||
    codePoints(whatExpected) > REPORT_TEXT_MAX ||
    new TextEncoder().encode(area).length > 0xff
  ) {
    throw new InvalidReportError(reason);
  }

  return {
    area,
    whatHappened,
    whatExpected,
    severity,
    page,
    attribution,
    ...(connectionId !== undefined ? { connectionId } : {}),
    ...(viewport !== undefined ? { viewport } : {}),
    ...(locale !== undefined ? { locale } : {}),
    at: new Date(atMs),
  };
}

function anonymousPlaintext(input: SubmitReportInput) {
  return {
    what_happened: input.whatHappened.trim(),
    what_expected: input.whatExpected.trim(),
    severity: input.severity,
    diagnostics: { page: input.page },
  };
}

function signedPlaintext(input: SubmitReportInput) {
  return {
    what_happened: input.whatHappened.trim(),
    what_expected: input.whatExpected.trim(),
    severity: input.severity,
    diagnostics: {
      page: input.page,
      ...(input.connectionId !== undefined
        ? { connection_id: input.connectionId }
        : {}),
      ...(input.viewport !== undefined ? { viewport: input.viewport } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
    },
  };
}

/** Internal exact-byte guard for the backend's serialized request ceiling. */
export function serializeReportEnvelope(envelope: WireEnvelope): string {
  const serialized = JSON.stringify(envelope);
  const serializedBytes = new TextEncoder().encode(serialized).byteLength;
  if (serializedBytes > REPORT_BODY_LIMIT) {
    throw new ReportBodyTooLargeError(serializedBytes, REPORT_BODY_LIMIT);
  }
  return serialized;
}

export class ReportService {
  readonly #config: IdNetworkConfig;
  readonly #signer: Signer;
  readonly #fetch: typeof fetch;

  constructor(options: ReportServiceOptions) {
    this.#config = options.config;
    this.#signer = options.signer;
    this.#fetch = options.fetchImpl;
  }

  async submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
    const snapshot = snapshotReportInput(input);
    const receivedHour = formatReceivedHour(snapshot.at);
    const currentHour = Date.parse(formatReceivedHour(new Date()));
    const receivedHourMs = Date.parse(receivedHour);
    if (
      !Number.isFinite(receivedHourMs) ||
      Math.abs(receivedHourMs - currentHour) > 60 * 60 * 1_000
    ) {
      throw new InvalidReportError("report hour is outside the accepted one-hour window");
    }
    const config = await this.#loadConfig();
    if (!config.areas.includes(snapshot.area)) {
      throw new InvalidReportError("area is not offered by the report service");
    }
    const plaintext = new TextEncoder().encode(
      JSON.stringify(
        snapshot.attribution === "signed"
          ? signedPlaintext(snapshot)
          : anonymousPlaintext(snapshot),
      ),
    );
    const predictedCiphertextBytes = plaintext.byteLength + HPKE_AEAD_TAG_BYTES;
    if (predictedCiphertextBytes > REPORT_CIPHERTEXT_LIMIT) {
      throw new ReportCiphertextTooLargeError(
        predictedCiphertextBytes,
        REPORT_CIPHERTEXT_LIMIT,
        config.recipients[0].key_id,
      );
    }
    let seals: Awaited<ReturnType<typeof sealToRecipients>>;
    try {
      seals = await sealToRecipients(
        config.recipients,
        plaintext,
        reportAad(snapshot.area, receivedHour),
      );
    } catch (cause) {
      throw new ReportSealError({ cause });
    }

    for (const seal of seals) {
      const ciphertextBytes = seal.ciphertext.length / 2;
      if (ciphertextBytes > REPORT_CIPHERTEXT_LIMIT) {
        throw new ReportCiphertextTooLargeError(
          ciphertextBytes,
          REPORT_CIPHERTEXT_LIMIT,
          seal.recipient_key_id,
        );
      }
    }

    let envelope: WireEnvelope;
    if (snapshot.attribution === "anonymous") {
      envelope = anonymousEnvelope(snapshot.area, receivedHour, seals);
    } else {
      const message = attributionMessage(
        snapshot.area,
        hourUnixSecs(receivedHour),
        seals,
      );
      let signatureHex: string;
      try {
        signatureHex = await this.#signer.sign(message);
      } catch (cause) {
        throw new SigningError({ cause });
      }
      if (!verifyStrict(message, signatureHex, this.#signer.publicKey)) {
        throw new LocalVerificationError();
      }
      envelope = signedEnvelope(
        snapshot.area,
        receivedHour,
        seals,
        this.#signer.signerHex,
        signatureHex.toLowerCase(),
      );
    }

    const serialized = serializeReportEnvelope(envelope);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.idOrigin}/api/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: serialized,
      });
    } catch (cause) {
      throw new IndeterminateReportSubmissionError({ cause });
    }
    if (!response.ok) {
      const reason = (await response.text().catch(() => "")) || undefined;
      if (response.status >= 500 && response.status < 600) {
        throw new IndeterminateReportSubmissionError({
          cause: new Error(`report intake returned HTTP ${response.status}${reason ? `: ${reason}` : ""}`),
        });
      }
      throw new ReportRejectedError(response.status, reason);
    }
    let acknowledgement: unknown;
    try {
      acknowledgement = await response.json();
    } catch (cause) {
      throw new IndeterminateReportSubmissionError({ cause });
    }
    if (
      response.status !== 200 ||
      typeof acknowledgement !== "object" ||
      acknowledgement === null ||
      (acknowledgement as { status?: unknown }).status !== "stored" ||
      Object.keys(acknowledgement).length !== 1
    ) {
      throw new IndeterminateReportSubmissionError();
    }
    return { status: "stored" };
  }

  async #loadConfig(): Promise<ReportConfig> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#config.idOrigin}/api/report/config`,
        { cache: "no-store" },
      );
    } catch (cause) {
      throw new ReportConfigError({ cause });
    }
    if (!response.ok) throw new ReportConfigError(undefined, response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new ReportConfigError({ cause });
    }
    if (!isReportConfig(body)) {
      throw new ReportConfigError();
    }
    return body;
  }
}
