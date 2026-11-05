import { InboxForm } from "@/components/InboxForm";

export default function InboxPage() {
  return (
    <>
      <h1>Inbox</h1>
      <p className="subtitle">
        Paste this morning&apos;s producer messages and triage them against open orders. Each message starts with a
        header line: <span className="mono">--- id | producer id or name | WHATSAPP or SMS | HH:MM</span>.
      </p>
      <InboxForm />
    </>
  );
}
