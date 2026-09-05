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
  /* Legacy like CONTACTS below: the CV and cover letter are no longer
     generated automatically — the user writes and uploads them by hand — so
     reading the uploaded Fassung is nothing to do either. Only rows from
     older runs still carry the key, and a resumed run closes them. */
  [AgentStepKey.READ_CV]: () => ({
    wait: 'Hochgeladenen {doc} einlesen',
    run: 'Hochgeladener {doc} wird eingelesen…',
    done: 'Einlesen übersprungen — Dokumente werden manuell erstellt',
  }),
  [AgentStepKey.READ_LETTER]: () => ({
    wait: 'Hochgeladenen {doc} einlesen',
    run: 'Hochgeladener {doc} wird eingelesen…',
    done: 'Einlesen übersprungen — Dokumente werden manuell erstellt',
  }),
  /* Legacy: automatic generation was removed, the user writes the Lebenslauf
     by hand now. Only rows from older runs still carry the key. */
  [AgentStepKey.GEN_CV]: (ctx) => ({
    wait: `Lebenslauf für ${ctx.company} erstellen`,
    run: `Lebenslauf für ${ctx.company} wird erstellt…`,
    done: 'Erstellung übersprungen — Lebenslauf wird manuell erstellt',
  }),
  /* Legacy: automatic generation was removed, the user writes the Anschreiben
     by hand now. Only rows from older runs still carry the key. */
  [AgentStepKey.GEN_LETTER]: (ctx) => ({
    wait: `Anschreiben für ${ctx.company} erstellen`,
    run: `Anschreiben für ${ctx.company} wird erstellt…`,
    done: 'Erstellung übersprungen — Anschreiben wird manuell erstellt',
  }),
  /* Legacy: rated the Anschreiben Kepler generated itself — nothing to rate
     once that generation was removed. Only rows from older runs remain. */
  [AgentStepKey.RATE]: () => ({
    wait: 'Anschreiben mit Opus 5 bewerten',
    run: 'Anschreiben wird mit Opus 5 bewertet…',
    done: 'Bewertung übersprungen — kein automatisch erstelltes Anschreiben',
  }),
  /* Legacy: checked claims in the Anschreiben Kepler generated itself —
     nothing to check once that generation was removed. Only rows from older
     runs remain. */
  [AgentStepKey.PROOFS]: () => ({
    wait: 'Belege prüfen',
    run: 'Belege werden geprüft…',
    done: 'Prüfung übersprungen — kein automatisch erstelltes Anschreiben',
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
    step(AgentStepKey.COMMENT),
  ];
}
