// Narrow checks for server responses. Adapters read only the fields they use,
// so a changed response fails here with the field's path instead of turning
// into undefined deep inside a screen.

export class ResponseShapeError extends Error {
  readonly path: string

  constructor(path: string, expected: string) {
    super(`${path} should be ${expected}.`)
    this.name = 'ResponseShapeError'
    this.path = path
  }
}

type Json = Readonly<Record<string, unknown>>
type Read<T> = (value: unknown, path: string) => T

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ResponseShapeError(path, 'a string')
  return value
}

export function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ResponseShapeError(path, 'a finite number')
  return value
}

export function readInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value)) throw new ResponseShapeError(path, 'an integer')
  return value as number
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean')
    throw new ResponseShapeError(path, 'a boolean')
  return value
}

export function readOneOf<const T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (!values.includes(value as T))
    throw new ResponseShapeError(path, `one of ${values.join(', ')}`)
  return value as T
}

// The server may send null or leave the field out; both read as null.
export function readNullable<T>(
  value: unknown,
  path: string,
  read: Read<T>,
): T | null {
  return value === undefined || value === null ? null : read(value, path)
}

export function readArray<T>(value: unknown, path: string, read: Read<T>): T[] {
  if (!Array.isArray(value)) throw new ResponseShapeError(path, 'an array')
  return value.map((item, index) => read(item, `${path}[${index}]`))
}

export interface ObjectReader {
  readonly path: string
  string(key: string): string
  number(key: string): number
  integer(key: string): number
  boolean(key: string): boolean
  oneOf<const T extends string>(key: string, values: readonly T[]): T
  nullable<T>(key: string, read: Read<T>): T | null
  array<T>(key: string, read: Read<T>): T[]
  object(key: string): ObjectReader
  nullableObject(key: string): ObjectReader | null
  // Unchecked, for values passed on as they are (error details, say).
  raw(key: string): unknown
}

export function readObject(value: unknown, path = 'data'): ObjectReader {
  if (!isRecord(value)) throw new ResponseShapeError(path, 'an object')
  const at = (key: string) => `${path}.${key}`
  return {
    path,
    string: (key) => readString(value[key], at(key)),
    number: (key) => readNumber(value[key], at(key)),
    integer: (key) => readInteger(value[key], at(key)),
    boolean: (key) => readBoolean(value[key], at(key)),
    oneOf: (key, values) => readOneOf(value[key], values, at(key)),
    nullable: (key, read) => readNullable(value[key], at(key), read),
    array: (key, read) => readArray(value[key], at(key), read),
    object: (key) => readObject(value[key], at(key)),
    nullableObject: (key) => readNullable(value[key], at(key), readObject),
    raw: (key) => value[key],
  }
}
