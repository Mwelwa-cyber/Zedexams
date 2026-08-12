# Security Policy

ZedExams is a learning platform used by Zambian learners, teachers, and schools.
It holds learner accounts, school data, and payment records, so we take
vulnerability reports seriously and we want them to reach us privately.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security
problem.** A public report tells everyone about the weakness at the same moment
it tells us, and learner data is live behind it.

Report it through **GitHub private vulnerability reporting** instead:

1. Go to the [**Security** tab](https://github.com/Mwelwa-cyber/Zedexams/security)
   of this repository.
2. Click **Report a vulnerability**.
3. Describe what you found, where, and how to reproduce it.

The report is visible only to the maintainers. You can attach details, logs, and
proof-of-concept code to the advisory thread, and we can reply to you there.

If you have already opened a public issue by mistake, file the private report as
well and say so in it — we would rather have the duplicate than leave the details
in the open while we work out what to do.

### What to include

The more of this you can give us, the faster we can confirm and fix it:

- Where the problem is — a URL, a route, a callable function name, or a file path.
- What an attacker can do with it, and what access they need to start (anonymous,
  any signed-in learner, a teacher, an admin).
- Steps to reproduce, or a minimal proof of concept.
- Anything you already know about the impact — which accounts, which data, which
  collections.

### What to expect

- We aim to acknowledge a report within **5 working days**.
- We will tell you whether we can reproduce it, and what we intend to do.
- We will let you know when a fix ships, and we are happy to credit you in the
  advisory unless you would rather stay anonymous.

Please give us a reasonable window to ship a fix before discussing the issue
publicly.

## Scope

Reports about the following are in scope:

| Area | What it covers |
| --- | --- |
| `src/` | The React single-page app — auth flows, learner/teacher/admin surfaces, client-side handling of tokens and user data. |
| `functions/` | Cloud Functions — callables, HTTP endpoints, webhooks, the agent pipeline, payments, and the AI generators. |
| `firestore.rules`, `storage.rules` | Firestore and Cloud Storage security rules: any read or write a rule permits that it should not. |
| CI workflows (`.github/workflows/`) | Workflow configuration and supply-chain concerns — secret exposure, unsafe triggers, injection into a job. |
| `android/` | The Capacitor Android wrapper, including its native configuration and App Check integration. |

Findings we are particularly interested in: authentication or authorization
bypass, one user reading or writing another user's data, privilege escalation to
teacher or admin, exposed secrets or credentials, payment or subscription
tampering, and injection into a Cloud Function or a CI job.

### Out of scope

- Automated scanner output with no demonstrated impact on this application.
- Vulnerabilities in third-party services we depend on — report those to the
  service. Tell us if we are configuring one of them unsafely.
- Denial of service through volume alone, rate-limiting thresholds, and best-practice
  hardening suggestions (missing headers, weak TLS ciphers) with no exploit behind
  them.
- Social engineering of our users or staff, and physical attacks.

Please do not test against production in ways that degrade the service, access
data belonging to real users, or modify records that are not your own. If a proof
of concept would require any of that, describe it to us instead of running it.

## Dependencies

Dependency updates for known CVEs are handled through Dependabot and
`npm audit`. If you spot a vulnerable dependency we have not picked up, a private
report is welcome, but an ordinary pull request bumping it is fine too — that is
public information already.
