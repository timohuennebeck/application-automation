import { useMemo } from 'react';
import { UNKNOWN_COMPANY } from '../../shared/domain';
import { usedCompanyIds } from '../../state/selectors';
import { useApp } from '../../state/store-context';
import { ManagedSelectPopover } from '../../ui/ManagedSelectPopover';

/* The company dropdown behind an Unternehmen chip — the sidebar's and the person
   editor's alike. Every known company; a new name is created on write; the
   companies no card applies at any more can be removed. */
export function CompanyPopover({
  value,
  onPick,
  onClose,
  minWidth,
}: {
  value: string;
  onPick: (name: string) => void;
  onClose: () => void;
  minWidth?: number;
}) {
  const { st, deleteCompany } = useApp();
  /* The placeholder a cleared card is filed under is not a company anyone
     picks, so it stays out of the list. */
  const companies = useMemo(
    () =>
      Object.values(st.companies)
        .map((c) => c.name)
        .filter((name) => name !== UNKNOWN_COMPANY)
        .sort((a, b) => a.localeCompare(b, 'de')),
    [st.companies],
  );
  const unused = useMemo(() => {
    const used = usedCompanyIds(st);
    return new Map(
      Object.values(st.companies)
        .filter((c) => !used.has(c.id))
        .map((c) => [c.name, c.id]),
    );
  }, [st.applications, st.companies]);

  return (
    <ManagedSelectPopover
      options={companies}
      value={value}
      removable={(name) => unused.has(name)}
      removeTitle="Unternehmen löschen – keine Bewerbung verwendet sie"
      onRemove={(name) => {
        const id = unused.get(name);
        if (id !== undefined) deleteCompany(id);
      }}
      onPick={onPick}
      onClose={onClose}
      minWidth={minWidth}
    />
  );
}
