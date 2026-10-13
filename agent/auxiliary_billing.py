"""User-visible notices when auxiliary recovery changes Anthropic billing lanes."""
import logging

from agent.anthropic_credentials import _is_oauth_token, is_native_anthropic_host

logger = logging.getLogger(__name__)


def _billing_lane(client):
    base_url = str(getattr(client, "base_url", "") or "")
    if not base_url or not is_native_anthropic_host(base_url):
        return None
    credential = getattr(client, "api_key", None)
    if callable(credential):
        # The native SDK builder already resolved callable auth when it chose these
        # identity headers. A notice must not mint/refresh a second token. The outer
        # aux wrapper's is_oauth can disagree with the actual wire (#135091).
        from agent.anthropic_adapter import _OAUTH_ONLY_BETAS
        headers = getattr(getattr(client, "_real_client", None), "default_headers", None)
        if not isinstance(headers, dict):
            return None
        betas = headers.get("anthropic-beta", "").split(",")
        return "oauth" if any(beta in betas for beta in _OAUTH_ONLY_BETAS) else "api_key"
    if not isinstance(credential, str) or not credential:
        return None
    return "oauth" if _is_oauth_token(credential) else "api_key"


def warn_paid_fallback(primary, fallback, *, task, label, runtime):
    """Notify before dispatch: even an unsuccessful paid attempt may incur usage.

    The live session owns delivery/deduplication. No callback is inherited through the
    process-wide compatibility runtime, which may belong to another gateway session.
    """
    callback = (runtime or {}).get("billing_warning_callback")
    if not callable(callback):
        return
    try:
        if _billing_lane(primary) == "oauth" and _billing_lane(fallback) == "api_key":
            callback(
                f"⚠ Auxiliary {task or 'call'}: falling back from Anthropic OAuth to "
                f"{label} (x-api-key, pay-per-token). This may incur API charges. "
                "Review auxiliary fallback_chain and fallback_providers in config.yaml."
            )
    except Exception:  # health: allow BLE001 -- observer boundary; callback exceptions may contain credentials, so omit traceback
        # Observability must not change recovery when a client property or UI callback fails.
        logger.debug("Could not report auxiliary billing fallback")
