# Demo guide

How to present Cloud Delivery to a customer: value first, then the parts of the product that prove it, then a
clear next step. Use it live, or play the narrated video (below) and take questions.

**Length:** 20 minutes live (4 value, 12 product, 4 close and questions), or the 8-minute video.
**Audience:** ISV product and platform leaders, CTOs, cloud architects, field leadership (SEs and CSAs).
**Rule of thumb:** every product section answers "so what?" with one of the four value points.

---

## 1. Structure

| #   | Section                | Minutes | Goal                                      | Show                                                |
| --- | ---------------------- | ------- | ----------------------------------------- | --------------------------------------------------- |
| 1   | The problem            | 2       | Get them nodding                          | Slide: every install is a project                   |
| 2   | The approach and value | 2       | Name the four outcomes                    | Slides: approach, value                             |
| 3   | The console            | 1       | "This is real, and it's all in one place" | Home                                                |
| 4   | Solution catalog       | 3       | Reuse + trust                             | Catalog, a Validated solution, submit a GitHub repo |
| 5   | Offering designer      | 2       | Review built in; code generated           | Canvas, Review tab, IaC, Pipeline                   |
| 6   | Onboard a customer     | 3       | Speed: configuration, not a project       | Onboarding wizard → live                            |
| 7   | Isolation              | 2       | Risk: blast radius of one customer        | Delivery units → a customer unit                    |
| 8   | Upgrades and day two   | 2       | Scale                                     | Releases → rollout in rings; compliance; audit      |
| 9   | Recap and next step    | 2       | Agree a pilot                             | Slide: recap                                        |

Keep sections 4, 6 and 7 even if you're short on time: they carry the value story (reuse, speed, risk).

## 2. The value story (say this first)

**Problem, in their words.** "For a software company delivering on Azure, every customer install becomes its own
project. Someone negotiates the landing zone, hand-builds a pipeline and repeats the security review. Upgrades feel
risky, so customers drift onto different versions. Often one pipeline and one identity can reach every customer.
And great solutions built by field teams are hard to find, trust and reuse."

Ask: _"How long does your last customer install take, from contract to production? How many versions are live
today?"_ Their answer becomes your baseline; don't quote numbers you can't back.

**Approach.** Productize the deployment, not just the software:

- one catalog of solutions, owned by named people and reviewed before anyone can deploy them;
- onboarding a customer is configuration, not a project;
- every landing zone, solution and customer is isolated: its own repository, pipeline, identities and state;
- upgrades roll out in rings, with approvals and drift detection.

**Value, four ways.**

| Value                  | What it means                                                                           | Where you prove it |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------ |
| Faster time to value   | A customer onboarded in one guided session                                              | Section 6          |
| Lower risk             | Reviewed architectures, approved production changes, problems contained to one customer | Sections 5, 7      |
| Safe upgrades at scale | Rollouts in rings; drift caught nightly                                                 | Section 8          |
| Reuse                  | Field-built solutions become deployable products with owners                            | Section 4          |

## 3. Click path and talk track

Before you start: open the console, sign in, and close other tabs. Use a customer name the audience recognises
as neutral (e.g. "Northwind Utilities").

**3 · The console** — `Home`

> "This is the whole estate at a glance: the offerings you deliver, pipeline runs, what needs your attention, and
> the installed base across every customer."

**4 · Solution catalog** — `Solution catalog`

1. Scroll the cards. Point at owner, maturity badge, services and where it runs.
   > "Every solution has a named owner and a trust level."
2. Search "pipeline", then filter by _Hosted_. Clear.
3. Open **Pipeline integrity agent**. Show delivery models, _Trust_ and _Delivered from_.
   > "Validated means an offering passed architecture review and was published. It's delivered from its own
   > repository, environments, identities and state."
4. **Submit a solution** → paste a GitHub URL (e.g. `https://github.com/paulshaheen/OneGrid`) → **Inspect**.
   > "The platform pins the commit, recognises the Bicep, maps the Azure resources and checks license and
   > artifacts. It's honest about gaps, so nothing unreviewed reaches a customer."
   > Close the dialog (or submit, if you want to show the draft).

**5 · Offering designer** — `Offerings`

1. Canvas: "designed once".
2. **Review** tab: regions, landing zone policy, private networking, guardrails.
3. **Infrastructure as code**, then **Pipeline**.
   > "The Terraform and the release pipeline are generated from the design. Differences between customers are
   > variables, never forks."

**6 · Onboard a customer** — `Onboard customer`

1. Name the customer; pick _Hosted in your Azure_ (or the customer's tenant).
2. **Continue** through environments and landing zone placement.
3. At review, click **environments/\*** and **install.yml**.
   > "This customer gets its own repository. Onboarding adds a few files pinning the version per environment."
4. **Open pull request & start the run** → **Merge pull request** → **Approve & deploy production**.
   > "Plans run with read-only identities, dev and test deploy on merge, production waits for an approver."

**7 · Isolation** — `Delivery units` → filter by the customer → open it
Scroll _Environments_, _Cloud identities_, _Terraform state_.

> "Each environment has its own identities, trusted only for that environment and only when running the
> approved template. State is separate too. A mistake, or a compromise, stays inside one customer."

**8 · Upgrades and day two** — `Releases` → **Roll out vX** → **Create rollout** → start ring 0; then
`Compliance` and `Audit`.

> "New versions go out in rings, each starting only after the last succeeds. Drift is checked nightly, and
> the audit trail can't be edited."

**9 · Recap and next step** — slide

> "One catalog of reviewed, owned solutions. Onboarding as configuration. Isolation for every landing zone,
> solution and customer. Safe upgrades. Next step: a pilot with one of your solutions and one customer."

## 4. Questions you'll get

| Question                                             | Answer                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Is this Terraform or Bicep?                          | Both are accepted as sources; the platform generates Terraform for delivery.                                           |
| Does it deploy into the customer's tenant?           | Yes: hosted in your Azure, in the customer's tenant plugged into their landing zone, or a new landing zone.            |
| Where are secrets?                                   | None. Pipelines use OIDC federation, one identity per environment.                                                     |
| What stops one customer's pipeline touching another? | Separate repository, identities scoped to one subscription and pinned to one environment and template, separate state. |
| Can our field teams publish?                         | Yes, as Community. It becomes Validated when an offering passes architecture review.                                   |
| GitHub only?                                         | GitHub Actions by default; Azure DevOps is modelled with the same isolation.                                           |
| What's simulated in the demo?                        | The demo engine simulates GitHub calls and Azure deployments; the designs, generated code and checks are real.         |

Be upfront about the last one.

## 5. The narrated video

`bun demo/build.ts` (or `npm run demo:video`) records this story against a fresh copy of the demo data and writes:

- `demo/out/cloud-delivery-demo.mp4` — 1080p, narrated, with English subtitles you can turn on or off;
- `demo/out/cloud-delivery-demo.srt` — the same subtitles as a file;
- `demo/out/chapters.txt` — chapter timestamps for your agenda or video description.

**Your own voice.** Record each scene and save it as `demo/voice/<scene>.m4a` (or `.wav`, `.mp3`, `.aiff`),
using the scene ids and text in `demo/story.ts`. Scenes with a recording use it; the rest use text-to-speech.
Each scene lasts as long as its narration, so the video stays in sync.

**Better text-to-speech.** Install a premium voice (System Settings → Accessibility → Spoken Content → System
voice → Manage Voices, e.g. _Ava (Premium)_), then `DEMO_VOICE="Ava (Premium)" bun demo/build.ts`.

**Other settings:** `DEMO_RATE` (words per minute, default 172), `DEMO_USER_NAME` / `DEMO_USER_ROLE` (who is
signed in on screen), `FFMPEG` (path to ffmpeg). Needs macOS (`say`), ffmpeg and a production build.

To change the story, edit `demo/story.ts` (narration and actions) and `demo/slides.ts` (slides).
