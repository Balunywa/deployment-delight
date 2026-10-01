-- Landing zones can run their Terraform in GitHub Actions. Connecting one (repository, environments, OIDC
-- identities, state storage) is recorded as a run with its own log.
alter table public.foundation_runs drop constraint if exists foundation_runs_action_check;
alter table public.foundation_runs
  add constraint foundation_runs_action_check check (action in ('plan', 'apply', 'destroy', 'connect'));
