import { useState } from 'react';
import { Search, Sparkles, X, Loader2, Tv } from 'lucide-react';
import ChannelPicker from './ChannelPicker.jsx';
import { useChannelSearch } from '../../hooks/useChannelSearch.js';

const EXAMPLES = [
  { text: 'How to train for a marathon', tag: 'Sports' },
  { text: 'Best chocolate cake recipe', tag: 'Food & Drink' },
  { text: 'Tesla stock price analysis', tag: 'Business' },
  { text: 'Minecraft survival guide', tag: 'Gaming' },
  { text: 'Climate change and coral reefs', tag: 'Science' },
];

const DEMO_CHANNELS = [
  { name: 'MrBeast', tag: 'Entertainment' },
  { name: 'CNBC', tag: 'Business' },
  { name: 'Binging with Babish', tag: 'Food' },
  { name: 'Linus Tech Tips', tag: 'Technology' },
  { name: 'National Geographic', tag: 'Science' },
  { name: 'Yoga With Adriene', tag: 'Health' },
];

export default function TextInput({ onAnalyze, onChannelDetail, onClear, loading, error, hasEmbedding }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState('text'); // 'text' or 'channel'
  const [demoLoading, setDemoLoading] = useState(null);
  const { search: searchChannels, selectChannel } = useChannelSearch();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (text.trim()) onAnalyze(text.trim());
  };

  const handleChannelSelect = (channel) => {
    setText(channel.textInput || channel.title);
    onAnalyze(channel.textInput || channel.title);
    onChannelDetail?.(channel);
  };

  const handleDemoChannel = async (demo) => {
    setDemoLoading(demo.name);
    try {
      const res = await fetch(`/api/channels/search?q=${encodeURIComponent(demo.name)}&limit=1`);
      if (!res.ok) throw new Error('Channel not found');
      const data = await res.json();
      if (data.channels?.length > 0) {
        const detail = await selectChannel(data.channels[0].id);
        if (detail) {
          handleChannelSelect(detail);
          return;
        }
      }
      // Fallback: use name as free text
      setText(demo.name);
      onAnalyze(demo.name);
    } catch {
      setText(demo.name);
      onAnalyze(demo.name);
    } finally {
      setDemoLoading(null);
    }
  };

  const handleExample = (example) => {
    setText(example.text);
    onAnalyze(example.text);
  };

  const handleClear = () => {
    setText('');
    onClear();
  };

  return (
    <div className="px-6 py-3 border-b border-[var(--bg-tertiary)] bg-[var(--bg-secondary)]">
      <div className="flex items-center gap-3">
        {/* Mode toggle */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--bg-tertiary)]">
          <button
            onClick={() => setMode('channel')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'channel'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Channel
          </button>
          <button
            onClick={() => setMode('text')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'text'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Free Text
          </button>
        </div>

        {/* Input */}
        {mode === 'text' ? (
          <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste a channel description or any text to classify..."
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--bg-tertiary)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
            <button
              type="submit"
              disabled={!text.trim() || loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Analyze
            </button>
          </form>
        ) : (
          <div className="flex-1">
            <ChannelPicker onSelect={handleChannelSelect} />
          </div>
        )}

        {/* Clear */}
        {hasEmbedding && (
          <button
            onClick={handleClear}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Example pills — shown when no embedding is loaded */}
      {!hasEmbedding && mode === 'text' && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Try:</span>
          {EXAMPLES.map(ex => (
            <button
              key={ex.text}
              onClick={() => handleExample(ex)}
              disabled={loading}
              className="px-2.5 py-1 rounded-full text-xs bg-[var(--bg-primary)] border border-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {ex.text} <span className="text-[var(--accent)] ml-1 text-[10px]">{ex.tag}</span>
            </button>
          ))}
        </div>
      )}

      {/* Demo channel pills */}
      {!hasEmbedding && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1">
            <Tv className="w-3 h-3" /> Channels:
          </span>
          {DEMO_CHANNELS.map(demo => (
            <button
              key={demo.name}
              onClick={() => handleDemoChannel(demo)}
              disabled={loading || demoLoading}
              className="px-2.5 py-1 rounded-full text-xs bg-[var(--bg-primary)] border border-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {demoLoading === demo.name ? (
                <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
              ) : null}
              {demo.name} <span className="text-[var(--accent)] ml-1 text-[10px]">{demo.tag}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>
      )}
    </div>
  );
}
