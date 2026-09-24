-- User acceptance testing is a first-class customer environment, alongside dev, test, QA and staging.
alter type public.environment_type add value if not exists 'uat' before 'staging';
