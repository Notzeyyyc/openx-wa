export const POLL_LIMITS = { name: 255, optionLen: 100, options: 12 };

/**
 * Parse ".poll <question> | opt | opt" input into a WhatsApp poll payload.
 * Returns { ok:false, error } on bad input.
 */
export function buildPollPayload(input) {
    const parts = String(input || '').split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) return { ok: false, error: 'usage' };

    const [name, ...values] = parts;
    if (name.length > POLL_LIMITS.name) return { ok: false, error: 'name_too_long' };
    if (values.length > POLL_LIMITS.options) return { ok: false, error: 'too_many_options' };
    if (values.some(v => v.length > POLL_LIMITS.optionLen)) return { ok: false, error: 'option_too_long' };

    return { ok: true, poll: { name, values, selectableCount: 1 } };
}
