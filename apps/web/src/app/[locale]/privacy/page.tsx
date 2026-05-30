export default function PrivacyPage() {
  return (
    <article className="card">
      <div className="eyebrow">Privacy</div>
      <h1>Keys are not telemetry.</h1>
      <p className="lede">
        Free Playground API keys are not persisted. Pro keys are encrypted at the
        application layer and only used for user-configured monitoring tasks.
      </p>
    </article>
  );
}
