import { useState, useCallback, useRef, useEffect } from 'react';
import { IBService, TWSContract } from '../../services/IBService';
import styles from './SymbolSearch.module.css';

interface SymbolSearchProps {
  open: boolean;
  onClose: () => void;
  onSelect: (conId: number, symbol: string, name: string, exchange: string) => void;
}

type SecTypeFilter = 'STK' | 'FUT' | 'OPT' | 'IND';

export function SymbolSearch({ open, onClose, onSelect }: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [secType, setSecType] = useState<SecTypeFilter>('FUT');
  const [exchange, setExchange] = useState('');
  const [results, setResults] = useState<TWSContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
    if (!open) {
      setQuery('');
      setResults([]);
      setError(null);
    }
  }, [open]);

  const doSearch = useCallback(async (q: string, st: SecTypeFilter, exch: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await IBService.search(q, st, exch || undefined);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerSearch = useCallback(
    (q: string, st: SecTypeFilter, exch: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(q, st, exch), 400);
    },
    [doSearch],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.toUpperCase();
      setQuery(val);
      triggerSearch(val, secType, exchange);
    },
    [triggerSearch, secType, exchange],
  );

  const handleSecTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const st = e.target.value as SecTypeFilter;
      setSecType(st);
      if (query) triggerSearch(query, st, exchange);
    },
    [triggerSearch, query, exchange],
  );

  const handleExchangeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.toUpperCase();
      setExchange(val);
      if (query) triggerSearch(query, secType, val);
    },
    [triggerSearch, query, secType],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  const handleSelectContract = useCallback(
    (contract: TWSContract) => {
      onSelect(
        contract.conId,
        contract.symbol,
        contract.description || contract.localSymbol,
        contract.exchange,
      );
      onClose();
    },
    [onSelect, onClose],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h3>Symbol Search</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.searchRow}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            value={query}
            onChange={handleInputChange}
            placeholder="Enter symbol (e.g., ZS, ES, AAPL)..."
          />
          <select className={styles.secTypeSelect} value={secType} onChange={handleSecTypeChange}>
            <option value="FUT">Futures</option>
            <option value="STK">Stocks</option>
            <option value="IND">Indices</option>
            <option value="OPT">Options</option>
          </select>
          <input
            type="text"
            className={styles.exchangeInput}
            value={exchange}
            onChange={handleExchangeChange}
            placeholder="Exchange"
          />
          {loading && <span className={styles.spinner}>...</span>}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.results}>
          {results.map((contract) => (
            <div
              key={`${contract.conId}-${contract.lastTradeDate}`}
              className={styles.resultItem}
              onClick={() => handleSelectContract(contract)}
            >
              <div className={styles.resultMain}>
                <span className={styles.symbol}>{contract.localSymbol || contract.symbol}</span>
                <span className={styles.name}>{contract.description}</span>
              </div>
              <div className={styles.resultMeta}>
                <span className={styles.secType}>{contract.secType}</span>
                <span className={styles.exchange}>{contract.exchange}</span>
                {contract.lastTradeDate && (
                  <span className={styles.expiry}>Exp: {contract.lastTradeDate}</span>
                )}
                <span className={styles.conid}>#{contract.conId}</span>
              </div>
            </div>
          ))}
          {!loading && results.length === 0 && query.length > 0 && (
            <div className={styles.empty}>No results found</div>
          )}
        </div>
      </div>
    </div>
  );
}
