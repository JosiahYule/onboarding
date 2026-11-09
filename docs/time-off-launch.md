# Time-off rollout

- Portal launch: **December 1, 2026**.
- Employee leave recorded here begins **January 1, 2027**. The employee form opens on the 2027 allowance and rejects earlier leave. HR can still log/import historic leave.
- **Email cutover is not authorized yet.** `FEATURES.timeOffEmails` stays `false`. Dates do not automatically turn it on. No time-off request, cancellation or decision email is sent by the updated portal while paused, and saved test requests are not queued for later replay.
- The two existing Microsoft Forms and their Power Automate flows remain unchanged. Neither this migration nor the portal creates a Microsoft connection, a webhook or a scheduled email job. Onboarding and tech-support notifications are unaffected.

## Direct-manager choices

Read from the live forms on November 9, 2026:

| Form | Configuration |
| --- | --- |
| Integrated Staffing | The 11 verified manager choices are configured privately in the database. |
| Accountant / Administrative Staffing | The two verified manager choices are configured privately in the database. |

Keep production staff names, email addresses and recipient mappings out of public source control. Provision `time_off_managers` separately for a new environment. The schema migration contains no production roster seed data.

The employee's saved profile manager is preselected when they are an available choice. Employees can select a different direct manager for the request. A selection is required; the server validates the company, roster, active status and self-selection. Manager accounts do not need portal logins to appear in the list. A disabled login is excluded.

The request stores `direct_manager_id` and a server-derived `direct_manager_name`. It never updates `employees.manager_id`, changes access roles or grants managers access to other employees' records. HR sees the choice in request details; the employee sees it in request history. Old requests are not assigned a manager retrospectively.

The small `time_off_managers` roster can be maintained by admins in the database. Ordinary employees cannot read the staff directory or edit that roster. `get_time_off_managers()` exposes only the permitted choices. Its privileged implementation and trigger are in the non-exposed `private` schema.

## Prepared email routing

`get_time_off_request_recipients(p_request_id)` checks that the caller owns the request or is an active HR/admin user. It resolves:

| Recipient | Source |
| --- | --- |
| HR | Existing `system_settings.hr_notification_email`, configured privately |
| Direct manager | Email on the employee record referenced by **that request's** `direct_manager_id` |

There is no fallback to another manager. Missing recipients produce a warning instead of guessing an address, and a shared HR/manager address is deduplicated. The resolver only reads data; it does not send anything. Portal notification helpers return immediately while the email flag is false.

The existing generic portal `send-email` function still uses the portal's original Resend transport. **That is not a connection to the current Microsoft flow.** Do not enable the time-off flag as a substitute for the Microsoft cutover.

## Later, after explicit cutover authorization

1. Prepare a separate Microsoft flow endpoint or a copy of the existing routing flow. Preserve the live Forms-triggered flows until the replacement is verified.
2. Connect the portal's server-side notification transport to that endpoint. Resolve recipients from the saved request; do not accept arbitrary employee/recipient addresses from a browser. Preserve the established neutral sender, HR + manager recipients and any required PDF/approval behavior. Resolve all production addresses from private configuration.
3. Verify controlled delivery to HR and the selected manager, covering the ISL and both sister-company manager options, duplicate-address handling, failures and retries. Prevent duplicate delivery with a stable request/event key.
4. Enable time-off notifications only after this verification and explicit authorization. Keep any historical/test submissions out of the send path.
5. Retire or redirect the old form only as a separate, authorized step. Connecting the new system does not require breaking the current one.

This change deliberately stops before those steps.
