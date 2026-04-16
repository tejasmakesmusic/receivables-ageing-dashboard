"""Integration test package.

Importing ``app.db`` here registers the D15 FX-rate immutability hook
(a session-global ``before_flush`` listener) at integration-suite
collection time. Without this, ``pytest backend/tests/integration/``
alone leaves D15 silently dormant because no other import path in the
integration tree pulls in ``app.db`` as a side effect. The unit-suite
regression test (`test_d15_immutability_listener_is_registered`) would
still pass on its own — but it wouldn't be running in an
integration-only invocation, so the invariant would be unenforced for
every integration test that touches fx_rates.
"""

import app.db  # noqa: F401  # registers D15 before_flush listener
