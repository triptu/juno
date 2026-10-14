import { Schema } from 'effect'
import { Unsafe } from 'typebox'
import { payloadSchemas } from './payload'

/** Derive model parameters from the catalogue, omitting application-owned execution bindings.
 * The application resolves references and mints ids before decoding a stored CardPayload. */
export function modelPayloadSchema(kind: keyof typeof payloadSchemas) {
  const fields = Object.fromEntries(Object.entries(payloadSchemas[kind].fields).filter(([key]) => key !== 'action'))
  const schema = kind === 'sendMessage'
    ? Schema.Struct({ ...fields, messages: Schema.Array(Schema.Struct({
      target: payloadSchemas.sendMessage.fields.messages.value.fields.target,
      inTopic: payloadSchemas.sendMessage.fields.messages.value.fields.inTopic,
      threadTs: payloadSchemas.sendMessage.fields.messages.value.fields.threadTs,
      text: Schema.String,
    })).check(Schema.isMinLength(1), Schema.isMaxLength(5)) })
    : Schema.Struct(fields)
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })
  return Unsafe({ ...document.schema, $defs: document.definitions })
}
