export type PreparedPdfResponse = {
  valid: boolean;
  body: ReadableStream<Uint8Array> | null;
};

export async function preparePdfResponse(response: Response): Promise<PreparedPdfResponse> {
  const contentRange = response.headers.get("content-range");
  if (response.status === 206 && contentRange && !/bytes\s+0-/i.test(contentRange)) {
    return { valid: true, body: response.body };
  }
  if (!response.body) return { valid: false, body: null };

  const reader = response.body.getReader();
  const buffered: Uint8Array[] = [];
  const signature: number[] = [];
  while (signature.length < 5) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered.push(chunk.value);
    signature.push(...chunk.value.slice(0, 5 - signature.length));
  }
  if (new TextDecoder().decode(new Uint8Array(signature)) !== "%PDF-") {
    await reader.cancel().catch(() => undefined);
    return { valid: false, body: null };
  }

  let bufferedIndex = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (bufferedIndex < buffered.length) {
        controller.enqueue(buffered[bufferedIndex]);
        bufferedIndex += 1;
        return;
      }
      try {
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return { valid: true, body };
}
