import { Transform, TransformCallback, TransformOptions } from 'stream';

/**
 * Length of a packet header in bytes: 1 byte type, 2 byte unsigned LE packet length.
 */
const HEADER_LENGTH = 3;

/**
 * Transform stream that splits a stream into Runtime packets: { type: number; data: Buffer }.
 */
export default class PacketStream extends Transform {
  /**
   * An array of buffers that together contain all the data yet to be output as packets.
   */
  #buf: Buffer[];

  /**
   * The current number of unoutput bytes.
   */
  #bufLen: number;

  constructor(options?: TransformOptions) {
    if (options && (options.writableObjectMode || options.objectMode)) {
      throw new Error('PacketStream does not support writable object mode.');
    }
    super({
      readableObjectMode: true,
      ...(options || {}),
    });
    this.#buf = [];
    this.#bufLen = 0;
  }

  /**
   * Handles input data and outputs packets if possible.
   * @param chunk - the input data.
   * @param encoding - the encoding of the input data.
   * @param callback - a callback function to be called with the consumed chunk or an error
   * following processing.
   */
  // eslint-disable-next-line no-underscore-dangle
  _transform(
    chunk: any,
    encoding: NodeJS.BufferEncoding,
    callback: TransformCallback,
  ) {
    let chunkBuf: Buffer;
    if (chunk instanceof Buffer) {
      chunkBuf = chunk;
    } else if (typeof chunk === 'string') {
      chunkBuf = Buffer.from(chunk, encoding);
    } else {
      callback(
        new Error('PacketStream does not support writable object mode.'),
        null,
      );
      return;
    }
    this.#buf.push(chunkBuf);
    let shouldConcatHeader = this.#bufLen < HEADER_LENGTH;
    this.#bufLen += chunkBuf.byteLength;
    while (this.#tryReadPacket(shouldConcatHeader)) {
      shouldConcatHeader = false;
    }
    callback();
  }

  /**
   * Tries to output a packet from the data currently in the buffer. Regardless of whether data from
   * the buffer is consumed, the buffer will always either be left empty or start with a packet
   * header.
   * @param shouldConcatHeader - whether the 3 byte packet header at the beginning of the buffer may
   * be split into multiple Buffers.
   * @returns Whether a full packet was read and output and the next packet is ready to be attempted
   * to be read.
   */
  #tryReadPacket(shouldConcatHeader: boolean) {
    if (this.#bufLen < HEADER_LENGTH) {
      // Wait for complete header before reading packet
      return false;
    }
    if (shouldConcatHeader) {
      // Concat buffer in case the header is in multiple chunks, but only do this once per packet
      this.#buf = [Buffer.concat(this.#buf)];
    }
    const packetType = this.#buf[0].readUInt8(0);
    const packetLength = this.#buf[0].readUInt16LE(1);
    if (this.#bufLen < HEADER_LENGTH + packetLength) {
      // Wait for complete packet data before reading packet
      return false;
    }
    this.#buf[0] = this.#buf[0].subarray(HEADER_LENGTH); // Trim off header
    this.#buf = [Buffer.concat(this.#buf)]; // Get packet data in one Buffer
    this.push({
      type: packetType,
      data: this.#buf[0].subarray(0, packetLength),
    });
    this.#buf[0] = this.#buf[0].subarray(packetLength); // Trim off packet data
    this.#bufLen -= HEADER_LENGTH + packetLength;
    return true; // Packet successfully read, more may follow
  }
}
