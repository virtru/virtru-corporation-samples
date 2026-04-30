export const S4_TAG_SCHEMA = {
  classification: '/attr/classification/',
  relTo: '/attr/relto/',
  ntk: '/attr/needtoknow/',
  // new or additional tags or attributes to be returned in s4Services can be added below. 
} as const;

// Create a type based on the schema keys
export type TagSchemaKeys = keyof typeof S4_TAG_SCHEMA;