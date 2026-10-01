/*
 * cd-delivery-templates: the reusable workflows every unit repository calls at a pinned tag. Each cloud identity's
 * federated subject names one of these workflows at that tag (job_workflow_ref), so a unit repository can't reach
 * its credentials with a modified workflow.
 *
 * Conventions shared by every template:
 *   - plan jobs use the "<env>-plan" (or "plan") environment and a read-only identity; apply jobs use "<env>"
 *     (or "apply") and a write identity, behind that environment's reviewers and wait timer;
 *   - Terraform authenticates with OIDC (ARM_USE_OIDC) and keeps state in the unit's own azurerm backend, from
 *     environment variables vending sets: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, TF_STATE_*;
 *   - the saved plan is the only thing apply runs, and it expires after a day.
 */
import type { Platform } from "./model";

export type TemplateFile = { path: string; content: string };

const TF_VERSION = "1.13.4";

/** Written with %{{ … }} so TypeScript doesn't interpolate GitHub expressions. */
const gh = (s: string, p: Platform) =>
  s
    .replaceAll("%{{", "${{")
    .replaceAll("__ORG__", p.org)
    .replaceAll("__REF__", p.templatesRef)
    .replaceAll("__TF__", TF_VERSION)
    // An explicit bash shell runs with -eo pipefail, so "terraform … | tee" fails when Terraform does.
    .replace(/^permissions: \{\}$/m, "permissions: {}\ndefaults:\n  run:\n    shell: bash")
    .replace(/^\n/, "");

const TERRAFORM_ENV = `
    env:
      ARM_USE_OIDC: "true"
      ARM_USE_AZUREAD: "true"
      ARM_CLIENT_ID: %{{ vars.AZURE_CLIENT_ID }}
      ARM_TENANT_ID: %{{ vars.AZURE_TENANT_ID }}
      ARM_SUBSCRIPTION_ID: %{{ vars.AZURE_SUBSCRIPTION_ID }}
      TF_IN_AUTOMATION: "true"`;

const INIT = (dir: string) => `
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: __TF__
          terraform_wrapper: false
      - name: terraform init (unit backend)
        run: >-
          terraform -chdir=${dir} init -input=false
          -backend-config="storage_account_name=%{{ vars.TF_STATE_ACCOUNT }}"
          -backend-config="container_name=%{{ vars.TF_STATE_CONTAINER }}"
          -backend-config="key=%{{ vars.TF_STATE_KEY }}"
          -backend-config="use_azuread_auth=true"`;

/** Same counts the console shows for in-app plans (runner.server.ts summarize). */
const PLAN_SUMMARY_JQ = `[.resource_changes[]? | select((.change.actions | any(. == "no-op" or . == "read")) | not)
  | {a: .change.actions, t: (if .type == "azapi_resource" then ((.change.after.type // "azapi_resource") | split("@")[0]) else .type end), n: (.change.after.name // "")}] as $r
  | {add: ([$r[] | select(.a | index("create"))] | length),
     change: ([$r[] | select(.a | index("update"))] | length),
     destroy: ([$r[] | select(.a | index("delete"))] | length),
     byType: (reduce $r[] as $x ({}; .[$x.t] += 1)),
     managementGroups: [$r[] | select(.t == "Microsoft.Management/managementGroups" and (.a | index("create"))) | .n],
     policyAssignments: ([$r[] | select(.t | endswith("policyAssignments"))] | length),
     roleAssignments: ([$r[] | select(.t | endswith("roleAssignments"))] | length)}`;

const PLAN_MARKDOWN_JQ = `"### \\($title)\\n\\n**\\(.add) to add · \\(.change) to change · \\(.destroy) to destroy** · \\(.policyAssignments) policy assignments · \\(.roleAssignments) role assignments\\n\\n| Resource type | Changes |\\n|---|---:|\\n" + ([.byType | to_entries | sort_by(-.value)[] | "| \`\\(.key)\` | \\(.value) |"] | join("\\n"))`;

/** Errors Azure clears on a second pass (eventual consistency); the in-app runner retries the same ones. */
const TRANSIENT =
  "PolicyDefinitionNotFound|PolicySetDefinitionNotFound|RoleDefinitionDoesNotExist|PrincipalNotFound|ReferencedResourceNotProvisioned|AnotherOperationInProgress|ManagementGroupNotFound|AuthorizationFailed|RetryableError|Conflict";

const lz = `
# Platform landing zone: plan on pull requests with the read-only identity, apply the saved plan on main
# behind the "apply" environment. Called from lz-<tenant>/.github/workflows/landing-zone.yml.
name: landing-zone
on:
  workflow_call:
    inputs:
      apply:
        description: Apply the saved plan (push to main or manual run)
        type: boolean
        default: false
      destroy:
        description: Plan and apply a destroy of everything in state
        type: boolean
        default: false
      directory:
        type: string
        default: terraform
permissions: {}
jobs:
  plan:
    name: Plan
    runs-on: ubuntu-latest
    environment: plan
    permissions:
      id-token: write
      contents: read
      pull-requests: write${TERRAFORM_ENV}
      # The plan identity is read-only: the console registers resource providers before it opens the PR.
      ARM_RESOURCE_PROVIDER_REGISTRATIONS: none
      DIR: %{{ inputs.directory }}
      DESTROY: %{{ inputs.destroy }}
    steps:
      - uses: actions/checkout@v7${INIT("%{{ inputs.directory }}")}
      - name: terraform fmt and validate
        run: |
          terraform -chdir="$DIR" fmt -check -recursive
          terraform -chdir="$DIR" validate -no-color
      - name: terraform plan
        run: |
          flags=""
          if [ "$DESTROY" = "true" ]; then rm -f "$DIR"/*.imports.tf; flags="-destroy"; fi
          terraform -chdir="$DIR" plan -input=false -lock-timeout=5m -no-color $flags -out=tfplan | tee plan.txt
          terraform -chdir="$DIR" show -json tfplan | jq -c '__PLAN_SUMMARY__' > "$DIR/plan-summary.json"
      - name: Plan summary
        env:
          GH_TOKEN: %{{ github.token }}
          PR: %{{ github.event.pull_request.number }}
        run: |
          title="Landing zone plan"; [ "$DESTROY" = "true" ] && title="Destroy plan"
          jq -r --arg title "$title" '__PLAN_MARKDOWN__' "$DIR/plan-summary.json" > summary.md
          { echo; echo '<details><summary>terraform plan (last 80 lines)</summary>'; echo; echo '\`\`\`'; tail -n 80 plan.txt; echo '\`\`\`'; echo '</details>'; } >> summary.md
          cat summary.md >> "$GITHUB_STEP_SUMMARY"
          if [ -n "$PR" ]; then
            gh pr comment "$PR" --repo "$GITHUB_REPOSITORY" --body-file summary.md --edit-last 2>/dev/null \\
              || gh pr comment "$PR" --repo "$GITHUB_REPOSITORY" --body-file summary.md
          fi
      - uses: actions/upload-artifact@v7
        with:
          name: lz-plan
          path: |
            %{{ inputs.directory }}/tfplan
            %{{ inputs.directory }}/plan-summary.json
          retention-days: 1
          overwrite: true
  apply:
    name: Apply
    if: inputs.apply
    needs: plan
    runs-on: ubuntu-latest
    environment: apply
    concurrency:
      group: lz-apply-%{{ github.repository }}
      cancel-in-progress: false
    permissions:
      id-token: write
      contents: read${TERRAFORM_ENV}
      DIR: %{{ inputs.directory }}
      DESTROY: %{{ inputs.destroy }}
    steps:
      - uses: actions/checkout@v7${INIT("%{{ inputs.directory }}")}
      - uses: actions/download-artifact@v8
        with:
          name: lz-plan
          path: %{{ inputs.directory }}
      - name: terraform apply
        run: |
          flags=""
          if [ "$DESTROY" = "true" ]; then rm -f "$DIR"/*.imports.tf; flags="-destroy"; fi
          terraform -chdir="$DIR" apply -input=false -lock-timeout=5m -no-color -parallelism=20 tfplan 2>&1 | tee apply.txt && exit 0
          # Azure is eventually consistent: a definition or role can exist and still read as "not found" for a while.
          for attempt in 2 3 4; do
            grep -Eq '__TRANSIENT__' apply.txt || exit 1
            echo "::warning::Azure reported a transient error. Planning and applying again in 30s (attempt $attempt of 4)."
            sleep 30
            terraform -chdir="$DIR" apply -input=false -lock-timeout=5m -no-color -parallelism=20 -auto-approve $flags 2>&1 | tee apply.txt && exit 0
          done
          exit 1
`
  .replace("__PLAN_SUMMARY__", () => PLAN_SUMMARY_JQ.replace(/\s*\n\s*/g, " "))
  .replace("__PLAN_MARKDOWN__", () => PLAN_MARKDOWN_JQ)
  .replace("__TRANSIENT__", () => TRANSIENT);

const install = `
# One customer environment. The environment file pins an offering version and its digest; the package is the
# one built and attested when the solution released it (build once), never rebuilt here.
# Called once per environment, in ring order, from cust-<code>/.github/workflows/install.yml.
name: install
on:
  workflow_call:
    inputs:
      environment:
        description: Short environment name, e.g. dev, test, prod
        type: string
        required: true
      install:
        description: Install file stem, environments/<environment>/<install>.yaml (<solution>-<model>)
        type: string
        required: true
      apply:
        type: boolean
        default: false
permissions: {}
jobs:
  plan:
    runs-on: ubuntu-latest
    environment: %{{ inputs.environment }}-plan
    permissions:
      id-token: write
      contents: read
      attestations: read
      issues: write
    outputs:
      changed: %{{ steps.changed.outputs.changed }}${TERRAFORM_ENV}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 2
      - id: changed
        name: Did this environment change?
        env:
          FILE: environments/%{{ inputs.environment }}/%{{ inputs.install }}.yaml
          EVENT: %{{ github.event_name }}
        run: |
          if [ "$EVENT" != "push" ] || git diff --name-only HEAD~1 HEAD | grep -qx "$FILE"; then
            echo "changed=true" >> "$GITHUB_OUTPUT"
          else
            echo "changed=false" >> "$GITHUB_OUTPUT"
          fi
      - id: pin
        if: steps.changed.outputs.changed == 'true'
        name: Read the pinned offering version
        env:
          FILE: environments/%{{ inputs.environment }}/%{{ inputs.install }}.yaml
        run: |
          {
            echo "solution=$(yq '.offering.solution' "$FILE")"
            echo "offering=$(yq '.offering.model' "$FILE")"
            echo "version=$(yq '.offering.version' "$FILE")"
            echo "digest=$(yq '.offering.digest' "$FILE")"
          } >> "$GITHUB_OUTPUT"
      - id: app
        if: steps.changed.outputs.changed == 'true'
        uses: actions/create-github-app-token@v1
        with:
          app-id: %{{ vars.CD_APP_ID }}
          private-key: %{{ secrets.CD_APP_PRIVATE_KEY }}
          repositories: sol-%{{ steps.pin.outputs.solution }}
      - name: Download the released package and verify it
        if: steps.changed.outputs.changed == 'true'
        env:
          GH_TOKEN: %{{ steps.app.outputs.token }}
          REPO: %{{ github.repository_owner }}/sol-%{{ steps.pin.outputs.solution }}
          TAG: %{{ steps.pin.outputs.offering }}/v%{{ steps.pin.outputs.version }}
          DIGEST: %{{ steps.pin.outputs.digest }}
        run: |
          gh release download "$TAG" --repo "$REPO" --pattern offering.tgz --dir pkg
          echo "\${DIGEST#sha256:}  pkg/offering.tgz" | sha256sum --check
          gh attestation verify pkg/offering.tgz --repo "$REPO"
          mkdir -p work && tar -xzf pkg/offering.tgz -C work
          yq -o json '.inputs // {}' "environments/%{{ inputs.environment }}/%{{ inputs.install }}.yaml" > work/terraform/inputs.auto.tfvars.json
      - if: steps.changed.outputs.changed == 'true'
        uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: __TF__
          terraform_wrapper: false
      - name: terraform plan
        id: plan
        if: steps.changed.outputs.changed == 'true'
        run: |
          terraform -chdir=work/terraform init -input=false \\
            -backend-config="storage_account_name=%{{ vars.TF_STATE_ACCOUNT }}" \\
            -backend-config="container_name=%{{ vars.TF_STATE_CONTAINER }}" \\
            -backend-config="key=%{{ inputs.install }}.tfstate" \\
            -backend-config="use_azuread_auth=true"
          set +e
          terraform -chdir=work/terraform plan -input=false -lock-timeout=5m -detailed-exitcode -out=tfplan -no-color > plan.txt
          code=$?
          set -e
          cat plan.txt
          { echo "### %{{ inputs.environment }} plan"; echo '\`\`\`'; tail -n 200 plan.txt; echo '\`\`\`'; } >> "$GITHUB_STEP_SUMMARY"
          [ "$code" != 1 ] || exit 1
          echo "drift=$([ "$code" = 2 ] && echo true || echo false)" >> "$GITHUB_OUTPUT"
      - name: Report drift
        if: github.event_name == 'schedule' && steps.plan.outputs.drift == 'true'
        env:
          GH_TOKEN: %{{ github.token }}
          ENVIRONMENT: %{{ inputs.environment }}
          INSTALL: %{{ inputs.install }}
        run: |
          { echo "$INSTALL in $ENVIRONMENT no longer matches environments/$ENVIRONMENT/$INSTALL.yaml."; echo; echo '\`\`\`'; tail -n 150 plan.txt; echo '\`\`\`'; } > body.md
          gh issue create --repo "$GITHUB_REPOSITORY" --title "Drift: $INSTALL in $ENVIRONMENT" --label drift --body-file body.md
      - if: steps.changed.outputs.changed == 'true'
        uses: actions/upload-artifact@v7
        with:
          name: plan-%{{ inputs.environment }}-%{{ inputs.install }}
          path: work
          retention-days: 1
  apply:
    if: inputs.apply && needs.plan.outputs.changed == 'true'
    needs: plan
    runs-on: ubuntu-latest
    environment: %{{ inputs.environment }}
    concurrency:
      group: install-%{{ github.repository }}-%{{ inputs.environment }}-%{{ inputs.install }}
      cancel-in-progress: false
    permissions:
      id-token: write
      contents: read${TERRAFORM_ENV}
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: plan-%{{ inputs.environment }}-%{{ inputs.install }}
          path: work
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: __TF__
          terraform_wrapper: false
      - name: terraform apply (saved plan)
        run: |
          terraform -chdir=work/terraform init -input=false \\
            -backend-config="storage_account_name=%{{ vars.TF_STATE_ACCOUNT }}" \\
            -backend-config="container_name=%{{ vars.TF_STATE_CONTAINER }}" \\
            -backend-config="key=%{{ inputs.install }}.tfstate" \\
            -backend-config="use_azuread_auth=true"
          terraform -chdir=work/terraform apply -input=false -lock-timeout=5m tfplan
      - name: Verify
        run: terraform -chdir=work/terraform output -json > outputs.json && cat outputs.json
`;

const solution = `
# A solution: validate and sandbox-plan every offering on pull requests; on a release tag
# (<offering>/vX.Y.Z) build the offering package once, attest it, test deploy it to the solution's sandbox,
# then publish it as the release the control plane registers as an immutable version.
name: solution
on:
  workflow_call: {}
permissions: {}
jobs:
  validate:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: __TF__
          terraform_wrapper: false
      - name: fmt and validate every offering
        run: |
          for dir in offerings/*/terraform; do
            terraform -chdir="$dir" fmt -check -recursive
            terraform -chdir="$dir" init -backend=false -input=false >/dev/null
            terraform -chdir="$dir" validate -no-color
          done
  build:
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      attestations: write
    outputs:
      offering: %{{ steps.tag.outputs.offering }}
      version: %{{ steps.tag.outputs.version }}
      digest: %{{ steps.pack.outputs.digest }}
    steps:
      - uses: actions/checkout@v7
      - id: tag
        name: Parse <offering>/vX.Y.Z
        env:
          TAG: %{{ github.ref_name }}
        run: |
          [[ "$TAG" =~ ^([a-z0-9-]+)/v([0-9]+\\.[0-9]+\\.[0-9]+)$ ]] || { echo "::error::Tag must be <offering>/vX.Y.Z"; exit 1; }
          echo "offering=\${BASH_REMATCH[1]}" >> "$GITHUB_OUTPUT"
          echo "version=\${BASH_REMATCH[2]}" >> "$GITHUB_OUTPUT"
      - id: pack
        name: Build the offering package once
        env:
          OFFERING: %{{ steps.tag.outputs.offering }}
        run: |
          test -d "offerings/$OFFERING" || { echo "::error::offerings/$OFFERING not found"; exit 1; }
          tar -czf offering.tgz -C "offerings/$OFFERING" .
          echo "digest=sha256:$(sha256sum offering.tgz | cut -d' ' -f1)" >> "$GITHUB_OUTPUT"
      - uses: actions/attest-build-provenance@v2
        with:
          subject-path: offering.tgz
      - uses: actions/upload-artifact@v7
        with:
          name: offering
          path: offering.tgz
  sandbox:
    needs: build
    runs-on: ubuntu-latest
    environment: sandbox
    concurrency:
      group: sandbox-%{{ github.repository }}-%{{ needs.build.outputs.offering }}
      cancel-in-progress: false
    permissions:
      id-token: write
      contents: read${TERRAFORM_ENV}
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: offering
      - run: mkdir -p work && tar -xzf offering.tgz -C work
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: __TF__
          terraform_wrapper: false
      - name: Test deploy to the sandbox
        env:
          OFFERING: %{{ needs.build.outputs.offering }}
        run: |
          terraform -chdir=work/terraform init -input=false \\
            -backend-config="storage_account_name=%{{ vars.TF_STATE_ACCOUNT }}" \\
            -backend-config="container_name=%{{ vars.TF_STATE_CONTAINER }}" \\
            -backend-config="key=$OFFERING/sandbox.tfstate" \\
            -backend-config="use_azuread_auth=true"
          terraform -chdir=work/terraform apply -input=false -auto-approve -lock-timeout=5m -var-file=../sandbox.tfvars.json
  release:
    needs: [build, sandbox]
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: offering
      - name: Publish the immutable release
        env:
          GH_TOKEN: %{{ github.token }}
          TAG: %{{ github.ref_name }}
          DIGEST: %{{ needs.build.outputs.digest }}
          OFFERING: %{{ needs.build.outputs.offering }}
          VERSION: %{{ needs.build.outputs.version }}
        run: |
          jq -n --arg o "$OFFERING" --arg v "$VERSION" --arg d "$DIGEST" --arg c "$GITHUB_SHA" \\
            '{offering: $o, version: $v, digest: $d, commit: $c}' > release.json
          gh release create "$TAG" offering.tgz release.json --repo "$GITHUB_REPOSITORY" \\
            --title "$OFFERING v$VERSION" --notes "Digest $DIGEST. Registered by the control plane from release.json."
`;

const drift = `
# Nightly drift check for one unit environment: plan with the read-only identity and open an issue when the
# estate no longer matches the configuration.
name: drift
on:
  workflow_call:
    inputs:
      environment:
        description: Plan environment, e.g. plan or prod-plan
        type: string
        required: true
      directory:
        type: string
        default: terraform
permissions: {}
jobs:
  drift:
    runs-on: ubuntu-latest
    environment: %{{ inputs.environment }}
    permissions:
      id-token: write
      contents: read
      issues: write${TERRAFORM_ENV}
    steps:
      - uses: actions/checkout@v7${INIT("%{{ inputs.directory }}")}
      - id: plan
        name: terraform plan -detailed-exitcode
        run: |
          set +e
          terraform -chdir="%{{ inputs.directory }}" plan -input=false -lock=false -detailed-exitcode -no-color > drift.txt
          echo "code=$?" >> "$GITHUB_OUTPUT"
      - if: steps.plan.outputs.code == '2'
        name: Open a drift issue
        env:
          GH_TOKEN: %{{ github.token }}
          ENVIRONMENT: %{{ inputs.environment }}
        run: |
          { echo "Drift detected in $ENVIRONMENT."; echo; echo '\`\`\`'; tail -n 150 drift.txt; echo '\`\`\`'; } > body.md
          gh issue create --repo "$GITHUB_REPOSITORY" --title "Drift in $ENVIRONMENT" --label drift --body-file body.md
      - if: steps.plan.outputs.code == '1'
        run: exit 1
`;

const vend = `
# Vending: plan every request on pull requests; apply on main behind the "vend" environment (two reviewers).
# Creates unit repositories, environments, variables, identities, federated credentials and state containers.
name: vend
on:
  workflow_call:
    inputs:
      apply:
        type: boolean
        default: false
permissions: {}
jobs:
  plan:
    runs-on: ubuntu-latest
    environment: vend-plan
    permissions:
      id-token: write
      contents: read${TERRAFORM_ENV}
      GITHUB_OWNER: %{{ github.repository_owner }}
    steps:
      - uses: actions/checkout@v7
      - id: app
        uses: actions/create-github-app-token@v1
        with:
          app-id: %{{ vars.CD_APP_ID }}
          private-key: %{{ secrets.CD_APP_PRIVATE_KEY }}
          owner: %{{ github.repository_owner }}${INIT("terraform")}
      - name: terraform plan
        env:
          GITHUB_TOKEN: %{{ steps.app.outputs.token }}
        run: |
          terraform -chdir=terraform plan -input=false -lock-timeout=5m -out=tfplan -no-color | tee plan.txt
          { echo '### Vending plan'; echo '\`\`\`'; tail -n 300 plan.txt; echo '\`\`\`'; } >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@v7
        with:
          name: vend-plan
          path: terraform/tfplan
          retention-days: 1
  apply:
    if: inputs.apply
    needs: plan
    runs-on: ubuntu-latest
    environment: vend
    concurrency:
      group: vend
      cancel-in-progress: false
    permissions:
      id-token: write
      contents: read${TERRAFORM_ENV}
      GITHUB_OWNER: %{{ github.repository_owner }}
    steps:
      - uses: actions/checkout@v7
      - id: app
        uses: actions/create-github-app-token@v1
        with:
          app-id: %{{ vars.CD_APP_ID }}
          private-key: %{{ secrets.CD_APP_PRIVATE_KEY }}
          owner: %{{ github.repository_owner }}${INIT("terraform")}
      - uses: actions/download-artifact@v8
        with:
          name: vend-plan
          path: terraform
      - name: terraform apply
        env:
          GITHUB_TOKEN: %{{ steps.app.outputs.token }}
        run: terraform -chdir=terraform apply -input=false -lock-timeout=5m tfplan
`;

const release = `
# The control plane itself: build once per vX.Y.Z tag, attest, deploy to staging, then production behind approval
# and a wait timer. Called from cd-control-plane.
name: control-plane-release
on:
  workflow_call:
    inputs:
      app-name:
        type: string
        required: true
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: bun install --frozen-lockfile && npx tsc --noEmit -p . && npx vite build
      - run: |
          mkdir -p pkg && cp -R .output db pkg/
          (cd pkg && zip -qr ../cloud-delivery-app.zip .)
      - uses: actions/attest-build-provenance@v2
        with:
          subject-path: cloud-delivery-app.zip
      - uses: actions/upload-artifact@v7
        with:
          name: app
          path: cloud-delivery-app.zip
  deploy:
    needs: build
    strategy:
      max-parallel: 1
      matrix:
        environment: [staging, production]
    runs-on: ubuntu-latest
    environment: %{{ matrix.environment }}
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: app
      - uses: azure/login@v2
        with:
          client-id: %{{ vars.AZURE_CLIENT_ID }}
          tenant-id: %{{ vars.AZURE_TENANT_ID }}
          subscription-id: %{{ vars.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/webapps-deploy@v3
        with:
          app-name: %{{ inputs.app-name }}-%{{ matrix.environment }}
          package: cloud-delivery-app.zip
`;

const readme = `
# cd-delivery-templates

Reusable workflows every Cloud Delivery unit repository calls at a pinned tag (\`@__REF__\`).
Cloud identities trust these workflows only: each federated credential's subject is

\`\`\`text
repo:__ORG__/<unit-repo>:environment:<environment>:job_workflow_ref:__ORG__/cd-delivery-templates/.github/workflows/<template>.yml@refs/tags/__REF__
\`\`\`

| Template | Called by | Environments |
|---|---|---|
| \`lz.yml\` | \`lz-<tenant>\` | \`plan\` (read-only), \`apply\` (reviewers) |
| \`install.yml\` | \`cust-<customer>\`, once per environment in ring order | \`<env>-plan\`, \`<env>\` |
| \`solution.yml\` | \`sol-<product>\` | \`sandbox\`, \`release\` |
| \`drift.yml\` | every unit, nightly | its plan environment |
| \`vend.yml\` | \`cd-vending\` | \`vend-plan\`, \`vend\` (two reviewers) |
| \`release.yml\` | \`cd-control-plane\` | \`staging\`, \`production\` |

Releasing a new tag doesn't change any unit: each unit adopts it through a pull request that also updates its
identities' federated subjects (vending).

Generated by Cloud Delivery (\`src/lib/delivery/templates.ts\`). Change it there.
`;

export function deliveryTemplates(p: Platform): TemplateFile[] {
  return [
    { path: ".github/workflows/lz.yml", content: gh(lz, p) },
    { path: ".github/workflows/install.yml", content: gh(install, p) },
    { path: ".github/workflows/solution.yml", content: gh(solution, p) },
    { path: ".github/workflows/drift.yml", content: gh(drift, p) },
    { path: ".github/workflows/vend.yml", content: gh(vend, p) },
    { path: ".github/workflows/release.yml", content: gh(release, p) },
    { path: "README.md", content: gh(readme, p) },
  ];
}
