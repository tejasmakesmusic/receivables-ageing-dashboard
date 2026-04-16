"""Email client + templates (spec §8, D22).

  client.py     — Resend or SendGrid provider, selected via EMAIL_PROVIDER env
  templates/    — Jinja-rendered HTML for daily_digest + publish_notif
  sender.py     — enqueue + email_log row on send/fail

Implementation lands in Milestone 6.
"""
