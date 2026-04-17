"""Unit tests for session cookie layer (spec §11)."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.core.rbac import Role
from app.core.session import (
    SessionData,
    clear_session_cookie,
    create_session_cookie,
    read_session_cookie,
)


@pytest.fixture
def sample_session_data() -> SessionData:
    """Sample SessionData for testing."""
    return SessionData(
        user_id=uuid.uuid4(),
        role=Role.ANALYST,
        entity_id_scope=uuid.uuid4(),
    )


@pytest.fixture
def mock_settings() -> MagicMock:
    """Mock settings with test values."""
    settings = MagicMock()
    settings.session_secret = "test-secret-key"
    settings.session_max_age_seconds = 43200  # 12h
    settings.session_cookie_secure = False
    return settings


class TestCreateAndReadRoundtrip:
    """Test basic create/read cycle."""

    def test_create_and_read_roundtrip(
        self, sample_session_data: SessionData, mock_settings: MagicMock
    ) -> None:
        """Create a cookie and read it back — all fields should match."""
        # Create
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(sample_session_data, response)

        # Extract the cookie value from the mock response
        assert response.set_cookie.called
        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["key"] == "session"
        signed_value = call_kwargs["value"]

        # Read
        request = MagicMock()
        request.cookies = {"session": signed_value}
        with patch("app.core.session.get_settings", return_value=mock_settings):
            result = read_session_cookie(request)

        # Assert all fields match
        assert result is not None
        assert result.user_id == sample_session_data.user_id
        assert result.role == sample_session_data.role
        assert result.entity_id_scope == sample_session_data.entity_id_scope

    def test_create_and_read_roundtrip_entity_scope_none(self, mock_settings: MagicMock) -> None:
        """Test roundtrip with entity_id_scope=None."""
        session_data = SessionData(
            user_id=uuid.uuid4(),
            role=Role.CFO,
            entity_id_scope=None,
        )

        # Create
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(session_data, response)

        # Extract
        call_kwargs = response.set_cookie.call_args[1]
        signed_value = call_kwargs["value"]

        # Read
        request = MagicMock()
        request.cookies = {"session": signed_value}
        with patch("app.core.session.get_settings", return_value=mock_settings):
            result = read_session_cookie(request)

        # Assert
        assert result is not None
        assert result.user_id == session_data.user_id
        assert result.role == session_data.role
        assert result.entity_id_scope is None


class TestReadErrors:
    """Test error handling for read_session_cookie."""

    def test_read_missing_cookie_returns_none(self, mock_settings: MagicMock) -> None:
        """Missing cookie should return None."""
        request = MagicMock()
        request.cookies = {}

        with patch("app.core.session.get_settings", return_value=mock_settings):
            result = read_session_cookie(request)

        assert result is None

    def test_read_tampered_cookie_returns_none(self, mock_settings: MagicMock) -> None:
        """Tampered cookie value should return None."""
        request = MagicMock()
        request.cookies = {"session": "garbage-tampered-value"}

        with patch("app.core.session.get_settings", return_value=mock_settings):
            result = read_session_cookie(request)

        assert result is None

    def test_read_wrong_secret_returns_none(
        self, sample_session_data: SessionData, mock_settings: MagicMock
    ) -> None:
        """Reading with wrong secret should return None."""
        # Create with one secret
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        signed_value = call_kwargs["value"]

        # Try to read with different secret
        request = MagicMock()
        request.cookies = {"session": signed_value}

        wrong_settings = MagicMock()
        wrong_settings.session_secret = "different-secret"
        wrong_settings.session_max_age_seconds = 43200

        with patch("app.core.session.get_settings", return_value=wrong_settings):
            result = read_session_cookie(request)

        assert result is None

    def test_read_expired_cookie_returns_none(
        self, sample_session_data: SessionData, mock_settings: MagicMock
    ) -> None:
        """Expired cookie (SignatureExpired) should return None."""
        # Create a valid cookie
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        signed_value = call_kwargs["value"]

        # Force the serializer to raise SignatureExpired during loads
        from itsdangerous import SignatureExpired

        request = MagicMock()
        request.cookies = {"session": signed_value}

        with patch("app.core.session.URLSafeTimedSerializer") as mock_serializer_cls:
            mock_instance = mock_serializer_cls.return_value
            mock_instance.loads.side_effect = SignatureExpired("token expired")

            with patch("app.core.session.get_settings", return_value=mock_settings):
                result = read_session_cookie(request)

        assert result is None, "Expired cookie must return None"


class TestClearSessionCookie:
    """Test clear_session_cookie."""

    def test_clear_sets_max_age_zero(self, mock_settings: MagicMock) -> None:
        """clear_session_cookie should set max_age=0 and mirror the create attributes."""
        response = MagicMock()

        with patch("app.core.session.get_settings", return_value=mock_settings):
            clear_session_cookie(response)

        assert response.set_cookie.called
        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["key"] == "session"
        assert call_kwargs["value"] == ""
        assert call_kwargs["max_age"] == 0
        assert call_kwargs["path"] == "/"
        assert call_kwargs["httponly"] is True
        assert call_kwargs["samesite"] == "lax"
        # secure must mirror create_session_cookie so browser treats them as
        # the same cookie and deletes it.
        assert call_kwargs["secure"] == mock_settings.session_cookie_secure


class TestSessionDataVariations:
    """Test different role and scope combinations."""

    @pytest.mark.parametrize(
        "role",
        [Role.ANALYST, Role.CFO, Role.ADMIN, Role.PENDING],
    )
    def test_all_roles_roundtrip(self, mock_settings: MagicMock, role: Role) -> None:
        """Each role should roundtrip successfully."""
        session_data = SessionData(
            user_id=uuid.uuid4(),
            role=role,
            entity_id_scope=uuid.uuid4(),
        )

        # Create
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(session_data, response)

        # Extract
        call_kwargs = response.set_cookie.call_args[1]
        signed_value = call_kwargs["value"]

        # Read
        request = MagicMock()
        request.cookies = {"session": signed_value}
        with patch("app.core.session.get_settings", return_value=mock_settings):
            result = read_session_cookie(request)

        # Assert
        assert result is not None
        assert result.role == role


class TestCookieProperties:
    """Test cookie flags and properties are set correctly."""

    def test_create_session_cookie_sets_httponly_true(
        self, sample_session_data: SessionData, mock_settings: MagicMock
    ) -> None:
        """Cookie should always be httponly=True."""
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["httponly"] is True

    def test_create_session_cookie_respects_secure_flag(
        self, sample_session_data: SessionData
    ) -> None:
        """Cookie should respect settings.session_cookie_secure."""
        response = MagicMock()

        # Test with secure=False
        settings = MagicMock()
        settings.session_secret = "test-secret"
        settings.session_max_age_seconds = 43200
        settings.session_cookie_secure = False
        with patch("app.core.session.get_settings", return_value=settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["secure"] is False

        # Test with secure=True
        response.reset_mock()
        settings.session_cookie_secure = True
        with patch("app.core.session.get_settings", return_value=settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["secure"] is True

    def test_create_session_cookie_sets_samesite_lax(
        self, sample_session_data: SessionData, mock_settings: MagicMock
    ) -> None:
        """Cookie should always be samesite='lax'."""
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["samesite"] == "lax"

    def test_create_session_cookie_sets_path_root(
        self, sample_session_data: SessionData, mock_settings: MagicMock
    ) -> None:
        """Cookie should always be path='/'."""
        response = MagicMock()
        with patch("app.core.session.get_settings", return_value=mock_settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["path"] == "/"

    def test_create_session_cookie_uses_max_age_from_settings(
        self, sample_session_data: SessionData
    ) -> None:
        """Cookie max_age should come from settings."""
        response = MagicMock()

        settings = MagicMock()
        settings.session_secret = "test-secret"
        settings.session_max_age_seconds = 7200  # 2h
        settings.session_cookie_secure = False
        with patch("app.core.session.get_settings", return_value=settings):
            create_session_cookie(sample_session_data, response)

        call_kwargs = response.set_cookie.call_args[1]
        assert call_kwargs["max_age"] == 7200
