/** Reads a newline-delimited JSON stream and calls onMsg for each message. */
export async function readNdjson(res: Response, onMsg: (m: any) => void) {
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop()!;
    for (const l of lines) if (l.trim()) onMsg(JSON.parse(l));
  }
}
