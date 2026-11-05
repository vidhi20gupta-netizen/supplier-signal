"use client";

// Last line of defence for /inbox: the form and server actions return their own errors, so this
// only shows for something unexpected. It replaces the Next.js error page with a readable one.
export default function InboxError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card inbox-form">
      <h1>The inbox hit an error</h1>
      <p className="subtitle">
        Nothing was lost on the order book. Try again; if it keeps happening, the server log has the details
        {error.digest ? (
          <>
            {" "}under reference <span className="mono">{error.digest}</span>
          </>
        ) : null}
        .
      </p>
      <button type="button" className="btn-primary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
