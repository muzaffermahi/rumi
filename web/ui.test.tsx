// Interface pieces in a simulated browser: shortcuts, the command palette, the model picker and toast actions.
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {matches, record, show} from './keys';
import {CommandPalette} from './CommandPalette';
import {ModelPicker} from './ModelPicker';
import {ToastProvider, useToasts} from './Toasts';

afterEach(cleanup);
const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  new KeyboardEvent('keydown', {key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, ...mods});

describe('shortcuts', () => {
  it('match with the platform modifier', () => {
    expect(matches(key('Enter', {ctrlKey: true}), 'Mod+Enter')).toBe(true);
    expect(matches(key('Enter'), 'Mod+Enter')).toBe(false);
    expect(matches(key('k', {ctrlKey: true}), 'Mod+K')).toBe(true);
    expect(matches(key('k', {ctrlKey: true, shiftKey: true}), 'Mod+K')).toBe(false);
    expect(matches(key('?', {shiftKey: true}), 'Shift+?')).toBe(true);
  });
  it('are shown and recorded readably', () => {
    expect(show('Mod+Shift+F')).toBe('Ctrl+Shift+F');
    expect(show('Shift+?')).toBe('?');
    expect(record(key('f', {ctrlKey: true, altKey: true}))).toBe('Mod+Alt+F');
    expect(record(key('Control', {ctrlKey: true}))).toBe(null);
  });
});

describe('command palette', () => {
  it('filters by words and runs the chosen command with Enter', async () => {
    vi.useFakeTimers();
    const run = vi.fn(),
      close = vi.fn();
    render(
      <CommandPalette
        onClose={close}
        commands={[
          {id: 'a', group: 'Commands', label: 'New document', run: () => {}},
          {id: 'b', group: 'Documents', label: 'Garden notes', run},
          {id: 'c', group: 'Tasks', label: 'Research soil', run: () => {}},
        ]}
      />,
    );
    const input = screen.getByLabelText('Search commands');
    fireEvent.change(input, {target: {value: 'gard'}});
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, {key: 'Enter'});
    act(() => vi.runAllTimers());
    expect(close).toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('says when nothing matches', () => {
    render(<CommandPalette onClose={() => {}} commands={[{id: 'a', group: 'Commands', label: 'Settings', run: () => {}}]} />);
    fireEvent.change(screen.getByLabelText('Search commands'), {target: {value: 'zzz'}});
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });
});

describe('model picker', () => {
  const models = [
    {ref: 'anthropic/claude-sonnet', provider: 'anthropic', id: 'claude-sonnet', name: 'Sonnet', contextWindow: 200000, subscription: true},
    {ref: 'ollama/qwen3', provider: 'ollama', id: 'qwen3', name: 'qwen3', contextWindow: 32768, local: true},
  ];
  it('searches, groups by provider and chooses', () => {
    const onChange = vi.fn();
    render(<ModelPicker models={models} value="" onChange={onChange} defaultLabel="Default" />);
    fireEvent.click(screen.getByLabelText('Model'));
    expect(screen.getByText('anthropic')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search models'), {target: {value: 'qwen'}});
    expect(screen.queryByText('claude-sonnet')).toBeNull();
    fireEvent.click(screen.getByText('qwen3'));
    expect(onChange).toHaveBeenCalledWith('ollama/qwen3');
  });
});

describe('toasts', () => {
  function Demo({onUndo}: {onUndo: () => void}) {
    const t = useToasts();
    return <button onClick={() => t.notify('Inserted', {action: {label: 'Undo', run: onUndo}})}>go</button>;
  }
  it('carry an action that runs once and closes the toast', () => {
    const undo = vi.fn();
    render(
      <ToastProvider>
        <Demo onUndo={undo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByText('Undo'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Inserted')).toBeNull();
  });
});
