"""Google Workspace SSO + session management (spec D4, §11).

Implementation lands in Milestone 1:
  - Authlib OAuth client configured with GOOGLE_OAUTH_CLIENT_ID / _SECRET
  - `/auth/google/callback` exchanges code, verifies hd == emb.global
  - First-login creates user row with role = PENDING (D5)
  - Session via signed cookies (`itsdangerous`) — see spec §11
"""

from __future__ import annotations
