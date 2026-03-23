import { useState, useCallback, useRef, useEffect } from 'react';
import { IBService, TWSContract } from '../../services/IBService';
import { CacheInfo, INTERVAL_OPTIONS, IntervalOption } from '../../types/chart';
import { log } from '../../services/Logger';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './ImportDialog.module.css';

type TabMode = 'import' | 'load';

export interface ImportRequest {
  contract: TWSContract;
  interval: number;
  barSize: string;
  startDate: string;
  cachePath: string;
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (request: ImportRequest) => void;
  onLoad: (cachePath: string, sync: boolean) => void;
}

type SecTypeFilter = 'STK' | 'FUT' | 'OPT' | 'IND';

export function ImportDialog({ open, onClose, onImport, onLoad }: ImportDialogProps) {
  const focusTrapRef = useFocusTrap(open);
  const [tab, setTab] = useState<TabMode>('import');

  // ─── Import New State ─────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [secType, setSecType] = useState<SecTypeFilter>('FUT');
  const [exchange, setExchange] = useState('');
  const [results, setResults] = useState<TWSContract[]>([]);
  const [selectedContract, setSelectedContract] = useState<TWSContract | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<IntervalOption>(INTERVAL_OPTIONS[1]!); // 5 min
  const [startDate, setStartDate] = useState('2025-01-01');
  const [cacheName, setCacheName] = useState('');
  // importError no longer used since import is async in AppLayout

  // ─── Load Cache State ─────────────────────────────────────────
  const [caches, setCaches] = useState<CacheInfo[]>([]);
  const [selectedCache, setSelectedCache] = useState<CacheInfo | null>(null);
  const [loadingCaches, setLoadingCaches] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      if (tab === 'import' && inputRef.current) {
        inputRef.current.focus();
      }
      if (tab === 'load') {
        loadCacheList();
      }
    }
    if (!open) {
      // Reset state
      setQuery('');
      setResults([]);
      setSelectedContract(null);
      setSearchError(null);
      setSelectedCache(null);
    }
  }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate cache filename when contract or interval changes
  useEffect(() => {
    if (selectedContract) {
      const sym = selectedContract.localSymbol || selectedContract.symbol;
      const intLabel = selectedInterval.interval > 0
        ? `${selectedInterval.interval}m`
        : selectedInterval.barSize.replace(/\s+/g, '');
      setCacheName(`${sym}_${intLabel}.json`);
    }
  }, [selectedContract, selectedInterval]);

  // ─── Search ─────────────────────────────────────────────────────

  const doSearch = useCallback(async (q: string, st: SecTypeFilter, exch: string) => {
    if (q.length < 1) { setResults([]); return; }
    setSearching(true);
    setSearchError(null);
    try {
      const data = await IBService.search(q, st, exch || undefined);
      setResults(data);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const triggerSearch = useCallback((q: string, st: SecTypeFilter, exch: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q, st, exch), 400);
  }, [doSearch]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setQuery(val);
    setSelectedContract(null);
    triggerSearch(val, secType, exchange);
  }, [triggerSearch, secType, exchange]);

  const handleSecTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const st = e.target.value as SecTypeFilter;
    setSecType(st);
    if (query) triggerSearch(query, st, exchange);
  }, [triggerSearch, query, exchange]);

  const handleExchangeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setExchange(val);
    if (query) triggerSearch(query, secType, val);
  }, [triggerSearch, query, secType]);

  const handleSelectResult = useCallback((contract: TWSContract) => {
    setSelectedContract(contract);
  }, []);

  // ─── Import ─────────────────────────────────────────────────────

  const handleImport = useCallback(() => {
    if (!selectedContract) return;
    const finalCachePath = cacheName || `${selectedContract.localSymbol || selectedContract.symbol}_${selectedInterval.interval > 0 ? selectedInterval.interval + 'm' : selectedInterval.barSize.replace(/\s+/g, '')}.json`;
    // Emit request immediately — caller handles background download
    onImport({
      contract: selectedContract,
      interval: selectedInterval.interval,
      barSize: selectedInterval.barSize,
      startDate,
      cachePath: finalCachePath,
    });
    onClose();
  }, [selectedContract, selectedInterval, startDate, cacheName, onImport, onClose]);

  // ─── Cache List ─────────────────────────────────────────────────

  const loadCacheList = useCallback(async () => {
    setLoadingCaches(true);
    try {
      const list = await IBService.listCaches();
      setCaches(list);
    } catch (err) {
      log.error('ImportDialog', 'Failed to list caches:', err);
      setCaches([]);
    } finally {
      setLoadingCaches(false);
    }
  }, []);

  const handleLoad = useCallback((sync: boolean) => {
    if (!selectedCache) return;
    onLoad(selectedCache.path, sync);
    onClose();
  }, [selectedCache, onLoad, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={focusTrapRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="Import Security" onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h3>Import Security</h3>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        {/* Tab Toggle */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${tab === 'import' ? styles.tabActive : ''}`}
            onClick={() => setTab('import')}
          >
            Import New
          </button>
          <button
            className={`${styles.tab} ${tab === 'load' ? styles.tabActive : ''}`}
            onClick={() => { setTab('load'); loadCacheList(); }}
          >
            Load Cache
          </button>
        </div>

        {tab === 'import' ? (
          <div className={styles.tabContent}>
            {/* Symbol Search Row */}
            <div className={styles.searchRow}>
              <input
                ref={inputRef}
                type="text"
                className={styles.input}
                value={query}
                onChange={handleInputChange}
                placeholder="Enter symbol (e.g., ZS, ES, AAPL)..."
              />
              <select className={styles.select} value={secType} onChange={handleSecTypeChange}>
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
              {searching && <span className={styles.spinner}>...</span>}
            </div>

            {searchError && <div className={styles.error}>{searchError}</div>}

            {/* Results List */}
            <div className={styles.results}>
              {results.map((contract) => (
                <div
                  key={`${contract.conId}-${contract.lastTradeDate}`}
                  className={`${styles.resultItem} ${selectedContract?.conId === contract.conId ? styles.resultSelected : ''}`}
                  onClick={() => handleSelectResult(contract)}
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
              {!searching && results.length === 0 && query.length > 0 && (
                <div className={styles.empty}>No results found</div>
              )}
            </div>

            {/* Import Options (shown when contract is selected) */}
            {selectedContract && (
              <div className={styles.importOptions}>
                <div className={styles.optionRow}>
                  <label>Interval:</label>
                  <select
                    className={styles.select}
                    value={INTERVAL_OPTIONS.indexOf(selectedInterval)}
                    onChange={(e) => setSelectedInterval(INTERVAL_OPTIONS[Number(e.target.value)]!)}
                  >
                    {INTERVAL_OPTIONS.map((opt, i) => (
                      <option key={opt.label} value={i}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.optionRow}>
                  <label>Start Date:</label>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className={styles.optionRow}>
                  <label>Cache File:</label>
                  <input
                    type="text"
                    className={styles.input}
                    value={cacheName}
                    onChange={(e) => setCacheName(e.target.value)}
                  />
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.primaryBtn}
                    onClick={handleImport}
                  >
                    Import
                  </button>
                  <button className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.tabContent}>
            {loadingCaches && <div className={styles.loadingText}>Loading cache files...</div>}
            <div className={styles.results}>
              {caches.map((cache) => (
                <div
                  key={cache.path}
                  className={`${styles.resultItem} ${selectedCache?.path === cache.path ? styles.resultSelected : ''}`}
                  onClick={() => setSelectedCache(cache)}
                >
                  <div className={styles.resultMain}>
                    <span className={styles.symbol}>{cache.symbol}</span>
                    <span className={styles.name}>{cache.path}</span>
                  </div>
                  <div className={styles.resultMeta}>
                    <span className={styles.exchange}>{cache.exchange}</span>
                    <span className={styles.interval}>
                      {cache.interval > 0 ? `${cache.interval}m` : cache.barSize}
                    </span>
                    <span className={styles.barCount}>{cache.barCount.toLocaleString()} bars</span>
                    {cache.lastBarTime > 0 && (
                      <span className={styles.lastBar}>
                        Last: {new Date(cache.lastBarTime).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {!loadingCaches && caches.length === 0 && (
                <div className={styles.empty}>No cache files found</div>
              )}
            </div>
            {selectedCache && (
              <div className={styles.actions}>
                <button className={styles.primaryBtn} onClick={() => handleLoad(false)} title="Load cached data without fetching new bars">
                  Load from Cache
                </button>
                <button className={styles.primaryBtn} onClick={() => handleLoad(true)} title="Load cached data, then fetch new bars from TWS to fill the gap">
                  Load &amp; Update
                </button>
                <button className={styles.secondaryBtn} onClick={onClose}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
