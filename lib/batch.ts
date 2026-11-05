// Parses a pasted batch of producer messages. Format, one block per message:
//
//   --- M-01 | PR-02 | WHATSAPP | 07:42
//   message body, any number of lines
//
// The producer may be an id (PR-02) or a name ("Moradabad Brass Collective"); channel and time
// are optional (defaults WHATSAPP, the current time of day on TODAY). Lines starting with "# " before a header are comments.
// Date tokens in a body are resolved against TODAY, so the eval file stays consistent with the
// seeded order dates on any day:
//   {{+N}}          TODAY plus N days as a date, e.g. "6 Nov"
//   {{weekday-N}}   the weekday name N days before TODAY, e.g. "Saturday" ({{weekday+N}} for after)
import { addDays, TODAY } from "./dates";
import type { Channel, Message, Producer } from "./types";

const HEADER = /^---\s*(.+)$/;

function localDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function expandDateTokens(text: string, base = TODAY): string {
  return text
    .replace(/\{\{\s*\+(\d+)\s*\}\}/g, (_, n: string) =>
      localDate(addDays(base, Number(n))).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    )
    .replace(/\{\{\s*weekday\s*([+-])\s*(\d+)\s*\}\}/g, (_, sign: string, n: string) =>
      localDate(addDays(base, (sign === "-" ? -1 : 1) * Number(n))).toLocaleDateString("en-GB", { weekday: "long" }),
    );
}

function resolveProducer(ref: string, producers: Producer[]): Producer | undefined {
  const r = ref.trim().toLowerCase();
  return producers.find((p) => p.id.toLowerCase() === r) ?? producers.find((p) => p.name.toLowerCase().startsWith(r));
}

function toTimestamp(time: string | undefined): string {
  const [y, mo, d] = TODAY.split("-").map(Number);
  const at = new Date();
  at.setFullYear(y, mo - 1, d);
  const m = time?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (m) at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return at.toISOString();
}

export type ParseResult = { messages: Message[]; errors: string[] };

export function parseBatch(text: string, producers: Producer[]): ParseResult {
  const lines = expandDateTokens(text).replace(/\r\n/g, "\n").split("\n");
  const messages: Message[] = [];
  const errors: string[] = [];
  let current: { header: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    // Trailing "# " lines belong to the next message's comment block, not this body.
    while (current.body.length && /^(# |#$)/.test(current.body[current.body.length - 1].trim())) current.body.pop();
    const body = current.body.join("\n").trim();
    const [id, producerRef, channel, time] = current.header.split("|").map((s) => s.trim());
    const producer = producerRef ? resolveProducer(producerRef, producers) : undefined;
    const ch = (channel || "WHATSAPP").toUpperCase();
    if (!id) errors.push(`A header has no message id: "--- ${current.header}"`);
    else if (!producer) errors.push(`${id}: unknown producer "${producerRef ?? ""}"`);
    else if (ch !== "WHATSAPP" && ch !== "SMS") errors.push(`${id}: channel must be WHATSAPP or SMS`);
    else if (!body) errors.push(`${id}: empty message body`);
    else if (messages.some((m) => m.id === id)) errors.push(`${id}: duplicate message id`);
    else messages.push({ id, producerId: producer.id, channel: ch as Channel, receivedAt: toTimestamp(time), body });
    current = null;
  };

  for (const line of lines) {
    const header = line.match(HEADER);
    if (header) {
      flush();
      current = { header: header[1], body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();
  if (messages.length === 0 && errors.length === 0) errors.push('No messages found. Start each one with a "--- id | producer" line.');
  return { messages, errors };
}
