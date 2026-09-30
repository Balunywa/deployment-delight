/*
 * Title slides for the demo video, rendered in the same browser as the app so the recording is one continuous
 * take. 1920×1080, the console's colours.
 */

const shell = (body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; }
  body { font-family: -apple-system, "Segoe UI", Inter, system-ui, sans-serif; color: #e8eefc;
    background: radial-gradient(1200px 700px at 85% 0%, #1f3f7a 0%, transparent 60%), #0d1b36;
    display: flex; flex-direction: column; justify-content: center; padding: 0 160px; }
  .eyebrow { color: #7fb0ff; font-size: 26px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
  h1 { font-size: 88px; line-height: 1.05; font-weight: 800; margin-top: 18px; max-width: 1500px; }
  h2 { font-size: 64px; line-height: 1.1; font-weight: 800; margin-top: 14px; max-width: 1500px; }
  p.lead { font-size: 34px; line-height: 1.45; color: #b9c7e6; margin-top: 28px; max-width: 1400px; }
  ul { list-style: none; padding: 0; margin-top: 48px; display: grid; gap: 26px; max-width: 1500px; }
  li { font-size: 36px; line-height: 1.35; padding-left: 52px; position: relative; color: #dfe7f8; }
  li::before { content: ""; position: absolute; left: 0; top: 16px; width: 22px; height: 22px; border-radius: 6px;
    background: var(--dot, #ff8a5b); }
  li b { color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 28px; margin-top: 52px; max-width: 1600px; }
  .tile { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 18px; padding: 34px 38px; }
  .tile h3 { font-size: 36px; font-weight: 750; color: #fff; }
  .tile p { font-size: 27px; line-height: 1.4; color: #b9c7e6; margin-top: 10px; }
  .tile .k { display: inline-block; font-size: 20px; font-weight: 700; letter-spacing: .14em; color: #7fb0ff; text-transform: uppercase; }
  .brand { position: absolute; left: 160px; bottom: 70px; display: flex; align-items: center; gap: 16px; color: #9fb3d9; font-size: 24px; }
  .logo { width: 44px; height: 44px; border-radius: 10px; background: #3b82f6; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 24px; }
</style></head><body>${body}
<div class="brand"><span class="logo">C</span> Cloud Delivery</div>
</body></html>`;

export const SLIDES = {
  title: shell(`
    <div class="eyebrow">Cloud Delivery</div>
    <h1>Productize how your software lands on Azure</h1>
    <p class="lead">The problem, the value, and a walk through the platform, end to end.</p>`),

  problem: shell(`
    <div class="eyebrow">The problem</div>
    <h2>Every customer install becomes its own project</h2>
    <ul style="--dot:#ff8a5b">
      <li><b>Bespoke delivery.</b> Landing zones negotiated, pipelines hand-built and security reviewed again, customer by customer.</li>
      <li><b>Risky upgrades.</b> So customers drift onto different versions, and support gets harder every release.</li>
      <li><b>Shared blast radius.</b> One pipeline and one identity that can reach every customer.</li>
      <li><b>Lost field work.</b> Great solutions built by field teams are hard to find, trust and reuse.</li>
    </ul>`),

  approach: shell(`
    <div class="eyebrow">The approach</div>
    <h2>Productize the deployment, not just the software</h2>
    <ul style="--dot:#4ade80">
      <li><b>One catalog</b> of solutions, owned by named people and reviewed before anyone can deploy them.</li>
      <li><b>Onboarding is configuration,</b> not a project: a few files that pin a version per environment.</li>
      <li><b>Isolation by design:</b> every landing zone, solution and customer has its own repository, pipeline, identities and state.</li>
      <li><b>Upgrades in rings,</b> with approvals, bake time and nightly drift detection.</li>
    </ul>`),

  value: shell(`
    <div class="eyebrow">The value</div>
    <h2>What changes for you and your customers</h2>
    <div class="grid">
      <div class="tile"><span class="k">Speed</span><h3>Faster time to value</h3><p>A customer is onboarded in one guided session, not weeks of project work.</p></div>
      <div class="tile"><span class="k">Trust</span><h3>Lower risk</h3><p>Reviewed architectures, approved production changes, and problems contained to one customer.</p></div>
      <div class="tile"><span class="k">Scale</span><h3>Safe upgrades at scale</h3><p>New versions roll out in rings, and drift is caught before it becomes an incident.</p></div>
      <div class="tile"><span class="k">Reuse</span><h3>Field work becomes product</h3><p>Solutions built by SEs and CSAs become deployable offerings with owners.</p></div>
    </div>`),

  close: shell(`
    <div class="eyebrow">Recap</div>
    <h2>From bespoke projects to a delivery product</h2>
    <ul style="--dot:#7fb0ff">
      <li><b>A catalog</b> of reviewed, owned solutions, including your field teams' work.</li>
      <li><b>Onboarding as configuration,</b> ring by ring, with approvals where they matter.</li>
      <li><b>Isolation</b> for every landing zone, solution and customer.</li>
      <li><b>Next step:</b> a pilot with one of your solutions and one customer, end to end.</li>
    </ul>`),
};

export type SlideId = keyof typeof SLIDES;
