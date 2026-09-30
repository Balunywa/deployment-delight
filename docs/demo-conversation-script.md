# Demo conversation script

A word-for-word script for a 30-minute customer conversation: open with their problem, prove the value in the
product, and close on a pilot. **You** lines are what you say; **Ask** lines are questions to the customer;
_[Click]_ lines are what you do on screen; **If they say** lines are likely responses and how to handle them.

Don't read it verbatim. Learn the beats, keep the questions, and use their words back to them.

| Part                  | Minutes   | Purpose                                                      |
| --------------------- | --------- | ------------------------------------------------------------ |
| 0. Before the call    | —         | Set up so nothing breaks                                     |
| 1. Open and discover  | 5         | Their problem, in their words                                |
| 2. Frame the value    | 3         | The approach and four outcomes                               |
| 3. Demo               | 15        | Prove it: catalog, designer, onboarding, isolation, upgrades |
| 4. Close              | 5         | Agree a pilot                                                |
| 5. Handling questions | as needed | Objections and honest answers                                |

---

## 0. Before the call

- Open the console: `https://clouddelivery-nzdefv.azurewebsites.net` (or `http://localhost:3000`).
- Click through **Solution catalog**, **Offerings** and **Delivery units** once, so the first real page load
  isn't during the demo.
- Pick a neutral customer name for onboarding, e.g. **Northwind Utilities**. If it was used before, use
  "Northwind Energy" or add a number.
- Have `demo/out/cloud-delivery-demo.mp4` ready in a second window as a backup if anything misbehaves.
- Close notifications and other tabs. Zoom the browser to 110% if sharing to a large room.
- Have three facts ready about the customer: how many customers or tenants they deploy to, whether they deploy
  into their own Azure or customers' tenants, and who owns delivery today.

---

## 1. Open and discover (5 min)

**You:** "Thanks for the time. I want to spend the first few minutes on how you deliver to your customers today,
then show you something that changes that, and leave time to decide whether it's worth a pilot. Does that work?"

**Ask:** "Walk me through what happens after a customer signs. What does it take to get them running in Azure?"

> Listen for: landing zone negotiation, security reviews, hand-built pipelines, weeks of calendar time,
> dependence on one or two people.

**Ask:** "How long did the last one take, from contract to production?"

> Write the number down. This is your baseline; don't suggest one.

**Ask:** "How many versions of your product are running across customers right now?"

> Listen for: "several", "we don't really know", "some customers are years behind".

**Ask:** "If one customer's deployment pipeline or credentials were compromised, what else could they reach?"

> Often: "honestly, probably everything", or a pause. That's the isolation story.

**Ask (for field-heavy orgs):** "When one of your SEs or CSAs builds something great for a customer, what
happens to it afterwards?"

> Listen for: "it lives in their repo", "we rebuild it next time".

**You (summarise):** "So if I've got this right: each customer install is a project of around _[their number]_,
you've got _[their answer]_ versions live, credentials are shared more widely than you'd like, and good field
work doesn't get reused. Is that fair?"

> Get the "yes". Everything after this refers back to it.

---

## 2. Frame the value (3 min)

**You:** "Here's how we think about it. You've productized your software. What usually isn't productized is how
it lands on Azure: the landing zone, the pipeline, the security review, the upgrade. Cloud Delivery productizes
that."

**You:** "Four things change.

- **Speed:** onboarding a customer becomes one guided session, not a project.
- **Risk:** every architecture is reviewed before anyone can deploy it, production changes need an approver, and
  each customer is isolated, so a problem stays with one customer.
- **Scale:** new versions roll out in rings, and drift is caught every night.
- **Reuse:** solutions your field teams build become products others can deploy, with named owners."

**Ask:** "Which of those four matters most to you right now?"

> Lead the demo with their answer. Speed → start at onboarding. Risk → isolation early. Reuse → catalog first.
> The default order below works when they don't choose.

**You:** "Let me show you, and I'll keep it real: this is the actual product, not slides. The only thing
simulated is the calls to GitHub and Azure, so we don't deploy real resources during a demo."

---

## 3. Demo (15 min)

### 3.1 The console (1 min)

_[Click]_ **Home**

**You:** "This is the whole estate on one page: the offerings you deliver, pipeline runs, what needs your
attention, and every customer install."

_[Click]_ Scroll to **Installed base**.

**You:** "Every customer, every environment, and the version it's on. You asked earlier how many versions you're
running; here that's always one glance away."

### 3.2 Solution catalog: reuse and trust (4 min)

_[Click]_ **Solution catalog**

**You:** "Everything starts here. Each card is a solution: who owns it, how far it's validated, the Azure services
it's built from, and where it can run: hosted by you, in the customer's Azure, or plugged into their landing
zone."

_[Click]_ Type **pipeline** in the search box. Then click **Clear all**, and tick **Hosted** under _Runs in_.

**You:** "Search and filters work by industry, service, deployment model or owner. Real people's names, not a
central team nobody knows."

_[Click]_ Untick **Hosted**. Open **Pipeline integrity agent**.

**You:** "A solution has delivery models, versions and owners. Look at _Trust_: it's Validated, which means one of
its offerings passed architecture review and was published. Community solutions are listed but can't be deployed
until they get there."

_[Click]_ Point at **Delivered from**.

**You:** "And it's delivered from its own repository, with its own environments, identities and state. I'll come
back to why that matters."

_[Click]_ Back to **Solution catalog** → **Submit a solution** → paste
`https://github.com/paulshaheen/OneGrid` → **Inspect**.

**You:** "Here's the reuse part. Say a CSA built this for a customer. They paste the GitHub link. The platform pins
the exact commit, recognises the Bicep, and maps every Azure resource onto the services the platform supports."

_[Click]_ Scroll to the checks.

**You:** "And it's honest. This one uses resources the platform doesn't offer yet, has no license, and depends on a
build that can change underneath it. It can be listed right away, under the architect's name, but no customer can
get it until those are fixed. That's how you open the catalog to the field without lowering the bar."

**If they say:** "Our teams use Terraform, not Bicep."
**You:** "Either works as the source. The platform maps both, and generates Terraform for delivery."

_[Click]_ Close the dialog (Esc).

### 3.3 Offering designer: review built in (2 min)

_[Click]_ **Offerings**

**You:** "Each way of delivering a solution is designed once, on this canvas: the services, the network, where it
lands."

_[Click]_ **Review** tab.

**You:** "Review runs on every change: can every offered region run every service, does the landing zone policy
allow it, are private endpoints and guardrails on. You can't publish while a check fails."

_[Click]_ **Infrastructure as code**, then **Pipeline**.

**You:** "The Terraform and the release pipeline are generated from the design. Customer differences are variables,
never forks, so you're never maintaining a copy per customer."

**Ask:** "How many customer-specific forks or branches do you maintain today?"

### 3.4 Onboard a customer: speed (4 min)

_[Click]_ **Onboard customer** (top left).

**You:** "Now the part you said takes _[their number]_. Let's onboard a new customer."

_[Click]_ Replace the name with **Northwind Utilities**. Under _Where it runs_, pick the card that says
**Your tenant · your hosting landing zone**.

**You:** "Pick the solution and where it runs: in our Azure, or in the customer's tenant. If it's their tenant, we
send their admin a link; they approve access themselves, and no one shares a password."

_[Click]_ **Continue** through _Access_ and _Landing zone & environments_.

**You:** "Environments and placement come from the landing zone design, one subscription per environment. No
negotiation; it's the design you already agreed."

_[Click]_ **Continue** to _Release pipeline_. Point at the **GitHub organization** field.

**You:** "This customer gets its own repository. Not a folder in a shared repo: its own."

_[Click]_ **Continue** to _Review & launch_. Click **environments/\***.

**You:** "And this is everything onboarding adds: a file per environment that pins the version. That's the whole
customer, as configuration."

_[Click]_ **Open pull request & start the run**. Wait for "ready to merge". Click **Merge pull request**.

**You:** "It opens a pull request. The plans run with read-only identities, so nothing changes until someone
merges. Dev and test deploy on merge."

_[Click]_ When it appears, **Approve & deploy production**.

**You:** "Production waits for an approver, and the person who made the change can't approve it themselves."

> Pause on "Northwind Utilities is live in every environment."

**You:** "That's a customer onboarded, reviewed and live, in one session. Compare that with _[their number]_."

**If they say:** "That's the demo engine, though."
**You:** "Yes, the GitHub and Azure calls are simulated here. The files, the pipeline definitions and the checks are
the real ones the platform generates. In a pilot, we run this against your GitHub organisation and a real
subscription."

### 3.5 Isolation: risk (3 min)

_[Click]_ **Delivery units** → type **northwind** in the filter → open **gridworks/cust-northwind-utilities**.

**You:** "Remember your answer about what a compromised pipeline could reach? This is the answer here."

_[Click]_ Scroll to **Environments**.

**You:** "The customer has its own repository and environments. Production needs a named team to approve, with a
wait before the next customers get the change."

_[Click]_ Scroll to **Cloud identities**.

**You:** "Each environment has its own identities: a read-only one for plans and a write one for deploys. Each is
trusted only for this repository, this environment, and only when it's running the approved pipeline template. A
modified pipeline can't get credentials."

_[Click]_ Scroll to **Terraform state**.

**You:** "State is separate per environment too. So if something goes wrong, it stays inside one customer."

**Ask:** "How would your security team feel about that model, compared with what you run today?"

_[Click]_ Scroll to **Repository content** and click the file under `cd-vending/requests/`.

**You:** "And this is the request that creates all of it. Reviewers approve exactly what gets created, nothing
more."

### 3.6 Upgrades and day two: scale (2 min)

_[Click]_ **Releases** → **Roll out vX.Y.Z** → **Create rollout**.

**You:** "When a new version ships, it rolls out in rings, not all at once. The platform checks which installs can
upgrade and groups them into waves."

_[Click]_ Start the first ring.

**You:** "Each ring starts only after the previous one succeeds. This is how you get everyone onto the same
version without a big-bang upgrade."

_[Click]_ **Compliance**, then **Audit**.

**You:** "Drift is checked every night, and every decision is recorded. The audit trail can't be edited, even by
us."

---

## 4. Close (5 min)

**You:** "So, back to where we started. Each install was a project of _[their number]_. You had _[their versions]_
live, credentials that could reach more than they should, and field work that didn't get reused. You've just seen
a customer onboarded in one session, isolated by design, upgradable in rings, and a catalog your field teams can
contribute to."

**Ask:** "What did you see that you'd want to prove in your own environment?"

> Let them answer. Their answer is the pilot's success criteria.

**You:** "Here's what I'd suggest: a pilot with one of your solutions and one customer, end to end. Four weeks.
We'd:

1. bring one of your solutions into the catalog and get it to Validated;
2. connect your GitHub organisation and one Azure subscription;
3. onboard one customer, or an internal test customer, through to production;
4. roll out one upgrade."

**Ask:** "Which solution and which customer would make the most convincing pilot for you?"

**Ask:** "Who else needs to be in the room to say yes: platform, security, a field lead?"

**You:** "I'll send a one-page pilot plan with those success criteria by _[day]_. Can we get 30 minutes with
_[their people]_ next week?"

> Leave the video (`cloud-delivery-demo.mp4`) with them so they can share it internally.

---

## 5. Handling questions

| They say                                               | You say                                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "We already have pipelines."                           | "Keep them. This gives each customer its own pipeline built from one approved template, so you stop maintaining a copy per customer."                             |
| "Our customers won't give us access to their tenant."  | "They don't give you standing access. Their admin approves an identity scoped to one subscription, and can revoke it any time. Or you host it in your own Azure." |
| "What about secrets?"                                  | "There aren't any. Pipelines sign in with short-lived tokens, one identity per environment."                                                                      |
| "Is this only GitHub?"                                 | "GitHub Actions by default; Azure DevOps uses the same model: repository per customer, required templates, approvals on environments."                            |
| "Terraform or Bicep?"                                  | "Both are accepted as source. Delivery uses generated Terraform, with separate state per environment."                                                            |
| "What if the platform is wrong about my architecture?" | "Owners see every check and the generated code before publishing. Nothing reaches a customer without passing review and an approval."                             |
| "Who maintains the landing zone?"                      | "Your platform team, in its own repository. Changes go to a test landing zone first, then to each tenant as a reviewed pull request."                             |
| "How is this different from Azure Marketplace?"        | "Marketplace is how you sell. This is how you deliver and operate every install afterwards: upgrades, drift, isolation, audit."                                   |
| "What's simulated?"                                    | "In the demo, the GitHub and Azure calls. The designs, generated files and checks are real. In a pilot, it's all real."                                           |
| "What does it cost to run?"                            | "Be honest: it depends on hosting and scale. Offer to size it as part of the pilot rather than quoting a number."                                                 |

**If something breaks during the demo:** "Let me show you the recorded version of this bit," and play that
chapter from the video (chapter times are in `demo/out/chapters.txt`). Keep going; don't debug live.

---

## Cheat sheet (one line per section)

1. **Discover:** time to onboard? versions live? blast radius? field reuse?
2. **Frame:** productize the deployment → speed, risk, scale, reuse. Ask which matters most.
3. **Catalog:** owners, trust, delivered from; submit OneGrid → honest gaps.
4. **Designer:** review on every change; code generated; no forks.
5. **Onboard:** Northwind → own repo → a file per environment → PR → approve prod → live.
6. **Isolation:** identities per environment, pinned to the template; state per environment.
7. **Upgrades:** rings; drift nightly; audit can't be edited.
8. **Close:** their words back; pilot with one solution and one customer; who decides; date.
