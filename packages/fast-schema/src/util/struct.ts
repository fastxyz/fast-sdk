import { Schema, String as Str } from 'effect';

/**
 * Converts a snake_case string to camelCase at the type level.
 *
 * @example
 * type R = SnakeToCamel<"token_id">; // "tokenId"
 * type R = SnakeToCamel<"recipient">; // "recipient"
 */
export type SnakeToCamel<S extends string> = S extends `${infer T}_${infer U}` ? `${T}${Capitalize<SnakeToCamel<U>>}` : S;

/**
 * Builds a `Schema.Struct` where snake_case wire keys are automatically
 * renamed to camelCase on the decoded (Type) side.
 *
 * Define fields using their wire-format snake_case names. Fields without
 * underscores pass through unchanged.
 *
 * @example
 * const TokenTransfer = CamelCaseStruct({
 *   token_id: TokenId,
 *   recipient: Address,
 *   amount: Amount,
 *   user_data: UserData,
 * });
 * // Type:    { tokenId, recipient, amount, userData }
 * // Encoded: { token_id, recipient, amount, user_data }
 */
export const CamelCaseStruct = <Fields extends Record<string, Schema.Schema.All>>(
  fields: Fields,
): Schema.Schema<
  { [K in keyof Fields as K extends string ? SnakeToCamel<K> : K]: Schema.Schema.Type<Fields[K]> },
  { [K in keyof Fields]: Schema.Schema.Encoded<Fields[K]> },
  never
> => {
  const structFields: Record<string, Schema.Struct.Field> = {};

  for (const key of Object.keys(fields)) {
    const schema = fields[key]!;
    const camelKey = Str.snakeToCamel(key);

    if (camelKey !== key) {
      structFields[camelKey] = Schema.propertySignature(schema).pipe(Schema.fromKey(key));
    } else {
      structFields[camelKey] = schema;
    }
  }

  return Schema.Struct(structFields) as never;
};
