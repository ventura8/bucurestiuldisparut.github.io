/**
 * The public start page (`docs/research/M14-start-your-map.md`): what you get, the cost in honest words, the accounts, then
 * Google's consent, the city and the project, the run, and the one console click no API can do. Every word comes from the
 * `start.*` catalogue, in logical CSS, with no kit element: this page loads before anything exists, and stays small.
 */
import { translateStart, type Locale, type StartKey } from '@hcm/shared';
import { LitElement, html, nothing, type TemplateResult } from 'lit';

import { defineOnce } from '../components/internal.js';
import { applyTheme } from '../theme/apply.js';
import { BASELINE_THEME } from '../theme/baseline.js';
import { defineHcmStartLanguage } from './hcm-start-language.js';
import { closedScreen, introScreen, type StartText } from './start-intro.js';
import { startHostStyles, startStyles } from './start-styles.js';

export const HCM_START_PAGE_TAG = 'hcm-start-page';

const STEPS = ['project', 'firebase', 'webApp', 'site', 'files', 'release'] as const;
const EDGES = ['west', 'south', 'east', 'north'] as const;

type StepId = (typeof STEPS)[number];
type Edge = (typeof EDGES)[number];

export interface StartPageFailure {
    readonly key: StartKey;
    readonly params?: Readonly<Record<string, string>>;
    readonly link?: { readonly key: StartKey; readonly url: string };
    readonly action: 'again' | 'consent' | 'form';
}

export interface StartPageView {
    readonly screen: 'closed' | 'intro' | 'plan' | 'work' | 'provider' | 'done';
    readonly locale: Locale;
    readonly form: {
        readonly nameRo: string;
        readonly nameEn: string;
        readonly cityId: string;
        readonly area: Readonly<Record<Edge, string>>;
        readonly create: boolean;
        readonly projectId: string;
        readonly picked: string;
    };
    readonly projects: readonly { readonly projectId: string; readonly displayName: string }[] | null;
    readonly notice: StartKey | null;
    readonly steps: Readonly<Record<StepId, 'waiting' | 'working' | 'done' | 'failed'>>;
    readonly files: { readonly done: number; readonly total: number };
    readonly failure: StartPageFailure | null;
    readonly busy: boolean;
    readonly plan: { readonly projectId: string; readonly city: { readonly name: { readonly ro: string } } } | null;
    readonly providerWaiting: boolean;
    readonly command: string;
}

export interface StartPagePort {
    readonly view: StartPageView;
    subscribe(listener: () => void): () => void;
    readonly intents: {
        setLocale(locale: Locale): void;
        signIn(): void;
        setName(name: string): void;
        setNameEn(name: string): void;
        setCityId(cityId: string): void;
        setEdge(edge: Edge, value: string): void;
        setCreate(create: boolean): void;
        setProjectId(projectId: string): void;
        setPicked(projectId: string): void;
        go(): void;
        tryAgain(): void;
        checkProvider(): void;
    };
    /** What the form says about its values (the form's own rules), and whether Create may run. */
    readonly problems: () => {
        readonly cityId: StartKey | null;
        readonly area: StartKey | null;
        readonly projectId: StartKey | null;
        readonly ready: boolean;
    };
}

interface FieldSpec {
    readonly id: string;
    readonly label: StartKey;
    readonly value: string;
    readonly input: (value: string) => void;
    readonly problem: StartKey | null;
    readonly help?: string;
}

const valueOf = (event: Event): string => (event.target as HTMLInputElement).value;

export class HcmStartPage extends LitElement {
    static override readonly properties = { port: { attribute: false } };
    static override readonly styles = [startHostStyles, startStyles];

    declare port: StartPagePort | undefined;
    #unsubscribe: (() => void) | null = null;

    override connectedCallback(): void {
        super.connectedCallback();
        applyTheme(this, BASELINE_THEME, 'system', false);
        this.#follow();
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#unsubscribe?.();
        this.#unsubscribe = null;
    }

    override willUpdate(changed: Map<PropertyKey, unknown>): void {
        if (changed.has('port')) {
            this.#follow();
        }
    }

    #follow(): void {
        this.#unsubscribe?.();
        this.#unsubscribe =
            this.port?.subscribe(() => {
                this.requestUpdate();
            }) ?? null;
    }

    #t(key: StartKey, params?: Readonly<Record<string, string>>): string {
        return translateStart(this.port?.view.locale ?? 'ro', key, params);
    }

    readonly #text: StartText = (key, params) => this.#t(key, params);

    override render(): TemplateResult {
        const view = this.port?.view;
        if (view === undefined) {
            return html``;
        }
        document.documentElement.lang = view.locale;
        return html`<header>
                <p class="brand" lang=${view.locale}>${this.#t('start.title')}</p>
                <hcm-start-language
                    .locale=${view.locale}
                    .choose=${(locale: Locale) => {
                        this.port?.intents.setLocale(locale);
                    }}
                ></hcm-start-language>
            </header>
            <main>${this.#screen(view)}</main>`;
    }

    #screen(view: StartPageView): TemplateResult {
        const screens: Readonly<Record<StartPageView['screen'], () => TemplateResult>> = {
            closed: () => closedScreen(this.#text, view),
            intro: () =>
                introScreen(this.#text, view, () => {
                    this.port?.intents.signIn();
                }),
            plan: () => this.#plan(view),
            work: () => this.#work(view),
            provider: () => this.#provider(view),
            done: () => this.#done(view),
        };
        return screens[view.screen]();
    }

    #field(spec: FieldSpec): TemplateResult {
        const { id, problem, help } = spec;
        const described = [help === undefined ? '' : `${id}-help`, problem === null ? '' : `${id}-problem`].join(' ').trim();
        return html`<div class="field">
            <label for=${id}>${this.#t(spec.label)}</label>
            <input
                id=${id}
                .value=${spec.value}
                autocomplete="off"
                aria-invalid=${problem === null ? 'false' : 'true'}
                aria-describedby=${described === '' ? nothing : described}
                @input=${(event: Event) => {
                    spec.input(valueOf(event));
                }}
            />
            ${this.#fieldNotes(spec)}
        </div>`;
    }

    #fieldNotes({ id, problem, help }: FieldSpec): TemplateResult {
        const helpLine = help === undefined ? nothing : html`<p id="${id}-help" class="note">${help}</p>`;
        const problemLine = problem === null ? nothing : html`<p id="${id}-problem" class="alert">${this.#t(problem)}</p>`;
        return html`${helpLine} ${problemLine}`;
    }

    #edges(view: StartPageView, port: StartPagePort): TemplateResult {
        const problem = port.problems().area;
        return html`<fieldset>
            <legend>${this.#t('start.plan.area')}</legend>
            <p class="note">${this.#t('start.plan.areaHelp')}</p>
            <div class="edges">
                ${EDGES.map(
                    (edge) =>
                        html`<div class="field">
                            <label for="edge-${edge}">${this.#t(`start.plan.${edge}`)}</label>
                            <input
                                id="edge-${edge}"
                                inputmode="decimal"
                                .value=${view.form.area[edge]}
                                @input=${(event: Event) => {
                                    port.intents.setEdge(edge, valueOf(event));
                                }}
                            />
                        </div>`,
                )}
            </div>
            ${problem === null ? nothing : html`<p class="alert" data-area-problem>${this.#t(problem)}</p>`}
        </fieldset>`;
    }

    #projectKind(view: StartPageView, port: StartPagePort): TemplateResult {
        const radio = (create: boolean, label: StartKey): TemplateResult =>
            html`<label class="choice">
                <input
                    type="radio"
                    name="kind"
                    .checked=${view.form.create === create}
                    @change=${() => {
                        port.intents.setCreate(create);
                    }}
                />
                ${this.#t(label)}
            </label>`;
        return html`<fieldset>
            <legend>${this.#t('start.plan.projectKind')}</legend>
            ${radio(true, 'start.plan.newProject')} ${radio(false, 'start.plan.existingProject')}
            ${view.form.create ? this.#newProject(view, port) : this.#pickProject(view, port)}
        </fieldset>`;
    }

    #newProject(view: StartPageView, port: StartPagePort): TemplateResult {
        const { projectId } = view.form;
        return this.#field({
            id: 'project-id',
            label: 'start.plan.projectId',
            value: projectId,
            input: (value) => {
                port.intents.setProjectId(value);
            },
            problem: port.problems().projectId,
            help: this.#t('start.plan.projectIdHelp', { projectId: projectId === '' ? '…' : projectId }),
        });
    }

    #pickProject(view: StartPageView, port: StartPagePort): TemplateResult {
        if (view.projects === null || view.projects.length === 0) {
            return html`<p class="note" data-no-projects>${view.projects === null ? '…' : this.#t('start.plan.pickNone')}</p>`;
        }
        return html`<div class="field">
            <label for="picked">${this.#t('start.plan.pick')}</label>
            <select
                id="picked"
                @change=${(event: Event) => {
                    port.intents.setPicked(valueOf(event));
                }}
            >
                <option value=""></option>
                ${view.projects.map(
                    (project) =>
                        html`<option value=${project.projectId} ?selected=${project.projectId === view.form.picked}>
                            ${project.displayName} (${project.projectId})
                        </option>`,
                )}
            </select>
            <p class="note">${this.#t('start.plan.pickWarning')}</p>
        </div>`;
    }

    #plan(view: StartPageView): TemplateResult {
        const { port } = this;
        if (port === undefined) {
            return html``;
        }
        const { form } = view;
        return html`<h1>${this.#t('start.plan.title')}</h1>
            ${this.#failure(view)}
            <form
                @submit=${(event: Event) => {
                    event.preventDefault();
                    port.intents.go();
                }}
            >
                ${this.#field({
                    id: 'name-ro',
                    label: 'start.plan.cityName',
                    value: form.nameRo,
                    input: (value) => {
                        port.intents.setName(value);
                    },
                    problem: null,
                })}
                ${this.#field({
                    id: 'name-en',
                    label: 'start.plan.cityNameEn',
                    value: form.nameEn,
                    input: (value) => {
                        port.intents.setNameEn(value);
                    },
                    problem: null,
                })}
                ${this.#field({
                    id: 'city-id',
                    label: 'start.plan.cityId',
                    value: form.cityId,
                    input: (value) => {
                        port.intents.setCityId(value);
                    },
                    problem: port.problems().cityId,
                    help: this.#t('start.plan.cityIdHelp', { cityId: form.cityId === '' ? '…' : form.cityId }),
                })}
                ${this.#edges(view, port)} ${this.#projectKind(view, port)}
                <button type="submit" class="filled" ?disabled=${!port.problems().ready}>
                    ${this.#t(form.create ? 'start.plan.go' : 'start.plan.goExisting')}
                </button>
            </form>`;
    }

    #stepLabel(view: StartPageView, step: StepId): string {
        return step === 'files'
            ? this.#t('start.step.files', { done: String(view.files.done), total: String(view.files.total) })
            : this.#t(`start.step.${step}`);
    }

    #work(view: StartPageView): TemplateResult {
        return html`<h1>${this.#t('start.work.title')}</h1>
            <p>${this.#t('start.work.body')}</p>
            <ol class="steps">
                ${STEPS.map(
                    (step) =>
                        html`<li data-step=${step} data-state=${view.steps[step]}>
                            <span>${this.#stepLabel(view, step)}</span>
                            <span class="chip">${this.#t(`start.step.state.${view.steps[step]}`)}</span>
                        </li>`,
                )}
            </ol>
            ${this.#failure(view)}`;
    }

    #failure(view: StartPageView): TemplateResult {
        const { failure } = view;
        if (failure === null) {
            return html``;
        }
        return html`<section class="panel" role="alert" data-failure=${failure.key}>
            <p>${this.#t(failure.key, failure.params)}</p>
            ${failure.link === undefined ? nothing : this.#external(failure.link.url, failure.link.key)} ${this.#failureAction(failure)}
        </section>`;
    }

    #failureAction(failure: StartPageFailure): TemplateResult {
        if (failure.action === 'form') {
            return html``;
        }
        return html`<button
            type="button"
            class="filled"
            @click=${() => {
                this.port?.intents.tryAgain();
            }}
        >
            ${this.#t(failure.action === 'consent' ? 'start.continue' : 'start.tryAgain')}
        </button>`;
    }

    #external(url: string, key: StartKey): TemplateResult {
        return html`<p><a href=${url} target="_blank" rel="noopener noreferrer">${this.#t(key)}</a></p>`;
    }

    #provider(view: StartPageView): TemplateResult {
        const projectId = view.plan?.projectId ?? '';
        return html`<h1>${this.#t('start.provider.title')}</h1>
            <p>${this.#t('start.provider.body')}</p>
            <p>${this.#t('start.provider.how')}</p>
            ${this.#external(`https://console.firebase.google.com/project/${projectId}/authentication/providers`, 'start.provider.link')}
            ${view.providerWaiting ? html`<p role="status" class="note" data-provider-waiting>${this.#t('start.provider.waiting')}</p>` : nothing}
            <button
                type="button"
                class="filled"
                @click=${() => {
                    this.port?.intents.checkProvider();
                }}
            >
                ${this.#t('start.provider.check')}
            </button>`;
    }

    #done(view: StartPageView): TemplateResult {
        const projectId = view.plan?.projectId ?? '';
        const address = `https://${projectId}.web.app/admin/`;
        return html`<h1>${this.#t('start.done.title')}</h1>
            <p>${this.#t('start.done.body', { address })}</p>
            <p>${this.#t('start.done.next', { city: view.plan?.city.name.ro ?? '' })}</p>
            <p><a class="filled" href=${address} data-open-admin>${this.#t('start.done.open')}</a></p>`;
    }
}

export function defineHcmStartPage(registry: CustomElementRegistry = customElements): void {
    defineHcmStartLanguage(registry);
    defineOnce(registry, HCM_START_PAGE_TAG, HcmStartPage);
}
