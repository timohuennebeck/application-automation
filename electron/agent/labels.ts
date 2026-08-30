/* Every German string of the run timeline, in the three grammatical forms the
   panel shows: the infinitive while a step waits (and when it failed — the
   work reads as still to do), the progressive while it runs, the participle
   once it is done. Labels keep the {m}/{doc} placeholders literal; the panel
   renders those as chips. */
import { AgentStepKey, AgentStepStatus } from '../../src/shared/enums.ts';
import { TemplateKind } from '../../src/shared/enums.ts';
import type { StepInput } from './run-store.ts';

export interface LabelCtx {
  /* The company as currently named — rewritten into waiting labels once the
     extraction knows the real name. */
  company: string;
  /* Where the posting lives ("LinkedIn", "Karriereseite"), '' when unknown. */
  source: string;
}

export const QUEUE_HEADLINE = 'Kepler wartet in der Warteschlange…';
/* The interrupted-run headline lives in src/shared/agent.ts — the renderer
   shows it too (panel heading, card strip), so it is contract, not copy. */
/* The step error after the user pressed stop — the run reads as failed so
   the same retry picks it back up. {m} is the user's mention chip, as in the
   step labels. */
export const STOP_ERROR = 'Lauf von {m} manuell gestoppt.';

/* "auf LinkedIn" but "auf der Karriereseite" — the article belongs to the
   generic word, not to platform names. */
const onSource = (source: string) => (source === 'Karriereseite' ? 'der Karriereseite' : source);

type Forms = { wait: string; run: string; done: string };

const FORMS: Record<AgentStepKey, (ctx: LabelCtx) => Forms> = {
  [AgentStepKey.FETCH]: (ctx) => ({
    wait: 'Stellenanzeige auslesen',
    run: ctx.source ? `${ctx.source}-Stellenanzeige wird ausgelesen…` : 'Stellenanzeige wird ausgelesen…',
    done: ctx.source ? `Stellenanzeige auf ${onSource(ctx.source)} ausgelesen` : 'Stellenanzeige ausgelesen',
  }),
  [AgentStepKey.EXTRACT]: () => ({
    wait: 'Firmendetails ergänzen',
    run: 'Firmendetails werden ergänzt…',
    done: 'Firmendetails ergänzt',
  }),
  /* Legacy: no longer planned (the contact research was removed), but rows
     from older runs still carry the key and a resumed run closes them. */
  [AgentStepKey.CONTACTS]: () => ({
    wait: 'Kontaktdetails ergänzen',
    run: 'Kontaktdetails werden ergänzt…',
    done: 'Kontaktsuche übersprungen — Kontakte werden manuell gepflegt',
  }),
  [AgentStepKey.READ_CV]: () => ({
    wait: 'Hochgeladenen {doc} einlesen',
    run: 'Hochgeladener {doc} wird eingelesen…',
    done: 'Hochgeladenen {doc} eingelesen',
  }),
  [AgentStepKey.READ_LETTER]: () => ({
    wait: 'Hochgeladenen {doc} einlesen',
    run: 'Hochgeladener {doc} wird eingelesen…',
    done: 'Hochgeladenen {doc} eingelesen',
  }),
  [AgentStepKey.GEN_CV]: (ctx) => ({
    wait: `Lebenslauf für ${ctx.company} erstellen`,
    run: `Lebenslauf für ${ctx.company} wird erstellt…`,
    done: `Lebenslauf für ${ctx.company} erstellt`,
  }),
  [AgentStepKey.GEN_LETTER]: (ctx) => ({
    wait: `Anschreiben für ${ctx.company} erstellen`,
    run: `Anschreiben für ${ctx.company} wird erstellt…`,
    done: `Anschreiben für ${ctx.company} erstellt`,
  }),
  [AgentStepKey.RATE]: () => ({
    wait: 'Anschreiben mit Opus 5 bewerten',
    run: 'Anschreiben wird mit Opus 5 bewertet…',
    done: 'Anschreiben mit Opus 5 bewertet',
  }),
  [AgentStepKey.PROOFS]: () => ({
    wait: 'Belege prüfen',
    run: 'Belege werden geprüft…',
    done: 'Belege geprüft',
  }),
  /* Legacy like CONTACTS: the standalone format check was removed with the
     findings comment it reported into. */
  [AgentStepKey.VALIDATE]: () => ({
    wait: 'Daten und Formate prüfen',
    run: 'Daten und Formate werden geprüft…',
    done: 'Prüfung übersprungen',
  }),
  [AgentStepKey.COMMENT]: () => ({
    wait: 'Abschlusskommentar an {m} hinterlassen',
    run: 'Kommentar an {m} wird hinterlassen…',
    done: 'Abschlusskommentar an {m} hinterlassen',
  }),
};

/* The running label while the step is not checking but rewriting. A step
   called "Belege prüfen" that quietly generates a second Anschreiben would be
   lying about what the run is doing — and this is the one label the panel
   shows for the two minutes that takes. */
export const PROOFS_REWRITE_LABEL = 'Anschreiben wird mit belegten Angaben neu geschrieben…';

/* Same honesty for the rating step: while Opus' feedback is being worked into
   a fresh generation, the label says so instead of still claiming to rate. */
export const RATE_REWRITE_LABEL = 'Anschreiben wird nach Opus-Feedback überarbeitet…';

export function stepLabel(key: AgentStepKey, status: AgentStepStatus, ctx: LabelCtx): string {
  const forms = FORMS[key](ctx);
  if (status === AgentStepStatus.RUN) return forms.run;
  if (status === AgentStepStatus.DONE) return forms.done;
  return forms.wait;
}

/* The run's step list in order, every label in its waiting form. */
export function stepPlan(hasUrl: boolean, ctx: LabelCtx): StepInput[] {
  const step = (key: AgentStepKey, doc?: TemplateKind): StepInput => ({
    key,
    label: stepLabel(key, AgentStepStatus.WAIT, ctx),
    doc,
  });
  return [
    ...(hasUrl ? [step(AgentStepKey.FETCH)] : []),
    step(AgentStepKey.EXTRACT),
    step(AgentStepKey.READ_CV, TemplateKind.LEBENSLAUF),
    step(AgentStepKey.READ_LETTER, TemplateKind.ANSCHREIBEN),
    step(AgentStepKey.GEN_CV),
    step(AgentStepKey.GEN_LETTER),
    step(AgentStepKey.RATE),
    step(AgentStepKey.PROOFS),
    step(AgentStepKey.COMMENT),
  ];
}
