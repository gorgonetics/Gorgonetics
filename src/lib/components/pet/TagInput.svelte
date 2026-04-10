<script>
let { tags = [], allTags = [], onchange } = $props();

let inputValue = $state('');
let showSuggestions = $state(false);

const suggestions = $derived(
  inputValue.trim()
    ? allTags.filter((t) => t.toLowerCase().includes(inputValue.trim().toLowerCase()) && !tags.includes(t))
    : [],
);

function addTag(value) {
  const tag = value.trim().toLowerCase();
  if (!tag || tags.includes(tag)) return;
  const updated = [...tags, tag];
  onchange?.(updated);
  inputValue = '';
  showSuggestions = false;
}

function removeTag(tag) {
  onchange?.(tags.filter((t) => t !== tag));
}

function handleKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (suggestions.length > 0) {
      addTag(suggestions[0]);
    } else {
      addTag(inputValue);
    }
  } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
    removeTag(tags[tags.length - 1]);
  }
}

function handleInput(e) {
  inputValue = e.target.value;
  if (inputValue.includes(',')) {
    const parts = inputValue.split(',');
    for (const part of parts.slice(0, -1)) {
      addTag(part);
    }
    inputValue = parts[parts.length - 1];
  }
  showSuggestions = inputValue.trim().length > 0;
}

function handleFocus() {
  showSuggestions = inputValue.trim().length > 0;
}

function handleBlur() {
  showSuggestions = false;
}

function handleSuggestionMousedown(e, suggestion) {
  e.preventDefault();
  addTag(suggestion);
}
</script>

<div class="tag-input-wrapper">
  <div class="tag-input-container">
    {#each tags as tag}
      <span class="tag-pill">
        {tag}
        <button class="tag-remove" onclick={() => removeTag(tag)} aria-label="Remove tag {tag}">×</button>
      </span>
    {/each}
    <input
      class="tag-text-input"
      type="text"
      placeholder={tags.length === 0 ? 'Add tags...' : ''}
      value={inputValue}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onfocus={handleFocus}
      onblur={handleBlur}
    />
  </div>
  {#if showSuggestions && suggestions.length > 0}
    <div class="tag-suggestions">
      {#each suggestions.slice(0, 8) as suggestion}
        <button class="tag-suggestion" onmousedown={(e) => handleSuggestionMousedown(e, suggestion)}>
          {suggestion}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tag-input-wrapper {
    position: relative;
  }

  .tag-input-container {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #ffffff;
    min-height: 34px;
    align-items: center;
    cursor: text;
    transition: border-color 0.15s;
  }

  .tag-input-container:focus-within {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    background: #eff6ff;
    color: #3b82f6;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .tag-remove {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    color: #93c5fd;
    font-size: 13px;
    line-height: 1;
    display: flex;
    align-items: center;
  }

  .tag-remove:hover {
    color: #ef4444;
  }

  .tag-text-input {
    flex: 1;
    min-width: 60px;
    border: none;
    outline: none;
    font-size: 13px;
    color: #111827;
    background: transparent;
    padding: 2px 0;
  }

  .tag-text-input::placeholder {
    color: #9ca3af;
  }

  .tag-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    z-index: 10;
    max-height: 160px;
    overflow-y: auto;
  }

  .tag-suggestion {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    font-size: 13px;
    color: #374151;
    text-align: left;
    cursor: pointer;
  }

  .tag-suggestion:hover {
    background: #f3f4f6;
  }
</style>
