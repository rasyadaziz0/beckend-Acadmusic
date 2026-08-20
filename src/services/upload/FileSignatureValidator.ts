export class FileSignatureValidator {
  /**
   * Known magic bytes signatures.
   * offset is where the signature starts.
   * mask is an optional array of bytes that specifies which bytes in the signature to ignore (0x00 means ignore).
   * However, for our simple implementation, exact match is sufficient.
   */
  private static readonly SIGNATURES = [
    {
      mime: 'image/jpeg',
      exts: ['jpg', 'jpeg'],
      bytes: [0xff, 0xd8, 0xff],
      offset: 0,
    },
    {
      mime: 'image/png',
      exts: ['png'],
      bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      offset: 0,
    },
    {
      mime: 'image/gif',
      exts: ['gif'],
      bytes: [0x47, 0x49, 0x46, 0x38], // GIF8
      offset: 0,
    },
    {
      mime: 'image/webp',
      exts: ['webp'],
      bytes: [0x57, 0x45, 0x42, 0x50], // WEBP
      offset: 8, // WEBP starts at offset 8 (RIFF is at 0)
    },
    {
      // Valid WEBP files must also start with RIFF
      mime: 'image/webp',
      exts: ['webp'],
      bytes: [0x52, 0x49, 0x46, 0x46], // RIFF
      offset: 0,
    },
    // Future audio support can be added here
    {
      mime: 'audio/mpeg',
      exts: ['mp3'],
      bytes: [0x49, 0x44, 0x33], // ID3
      offset: 0,
    },
    {
      mime: 'audio/mpeg',
      exts: ['mp3'],
      bytes: [0xff, 0xfb], // MP3 without ID3 (MPEG-1 Layer 3)
      offset: 0,
    },
    {
      mime: 'audio/mpeg',
      exts: ['mp3'],
      bytes: [0xff, 0xf3], // MP3 without ID3 (MPEG-2 Layer 3)
      offset: 0,
    },
    {
      mime: 'audio/mpeg',
      exts: ['mp3'],
      bytes: [0xff, 0xf2], // MP3 without ID3 (MPEG-2.5 Layer 3)
      offset: 0,
    },
    {
      mime: 'audio/wav',
      exts: ['wav'],
      bytes: [0x52, 0x49, 0x46, 0x46], // RIFF
      offset: 0,
    },
    {
      mime: 'audio/wav',
      exts: ['wav'],
      bytes: [0x57, 0x41, 0x56, 0x45], // WAVE
      offset: 8,
    },
    {
      mime: 'audio/flac',
      exts: ['flac'],
      bytes: [0x66, 0x4c, 0x61, 0x43], // fLaC
      offset: 0,
    },
  ];

  /**
   * Validate the magic bytes of a given buffer.
   * Returns whether it's valid and the detected mime type if any.
   */
  public static validate(buffer: Uint8Array): { valid: boolean; detectedMime: string | null } {
    if (!buffer || buffer.length === 0) {
      return { valid: false, detectedMime: null };
    }

    // A file might match multiple signature parts (like WEBP needs RIFF + WEBP).
    // For simplicity, we just check if it matches at least one valid starting signature.
    // If we need stricter validation (e.g. BOTH RIFF and WEBP must match), we handle it.
    
    // Check for WEBP (needs both RIFF at 0 and WEBP at 8)
    if (this.checkSignature(buffer, [0x52, 0x49, 0x46, 0x46], 0) && buffer.length >= 12 && this.checkSignature(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
      return { valid: true, detectedMime: 'image/webp' };
    }

    // Check for WAV (needs both RIFF at 0 and WAVE at 8)
    if (this.checkSignature(buffer, [0x52, 0x49, 0x46, 0x46], 0) && buffer.length >= 12 && this.checkSignature(buffer, [0x57, 0x41, 0x56, 0x45], 8)) {
      return { valid: true, detectedMime: 'audio/wav' };
    }

    // Check other simpler signatures
    for (const sig of this.SIGNATURES) {
      // Skip the composite ones we already checked
      if (sig.mime === 'image/webp' || sig.mime === 'audio/wav') continue;

      if (this.checkSignature(buffer, sig.bytes, sig.offset)) {
        return { valid: true, detectedMime: sig.mime };
      }
    }

    return { valid: false, detectedMime: null };
  }

  private static checkSignature(buffer: Uint8Array, bytes: number[], offset: number): boolean {
    if (buffer.length < offset + bytes.length) return false;

    for (let i = 0; i < bytes.length; i++) {
      if (buffer[offset + i] !== bytes[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if the given extension is supported by our system.
   */
  public static isSupportedExtension(ext: string): boolean {
    const supported = this.getSupportedExtensions();
    return supported.includes(ext.toLowerCase());
  }

  public static getSupportedExtensions(): string[] {
    const exts = new Set<string>();
    this.SIGNATURES.forEach(sig => sig.exts.forEach(e => exts.add(e)));
    return Array.from(exts);
  }
}
