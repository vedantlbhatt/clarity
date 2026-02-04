declare module 'alawmulaw' {
  export interface Mulaw {
    (buffer: Buffer): Buffer;
    decodeSample(sample: number): number;
    encodeSample(sample: number): number;
  }
  export interface Alaw {
    (buffer: Buffer): Buffer;
    decodeSample(sample: number): number;
    encodeSample(sample: number): number;
  }
  export const mulaw: Mulaw;
  export const alaw: Alaw;
}
