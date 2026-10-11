/**
 * Romanian catalogue: the default locale and the source of truth for message keys.
 * Every other catalogue must define exactly these keys (enforced by the `Messages` type).
 */
export const ro = {
    'app.title': 'București dispărut',
    'engine.name': 'Hartă istorică a orașului',
    'admin.title': 'Administrare',
    'hello.greeting': 'Salut, {name}!',
} as const;

export type MessageKey = keyof typeof ro;

export type Messages = Readonly<Record<MessageKey, string>>;
