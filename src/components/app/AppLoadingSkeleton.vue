<script setup lang="ts">
import type { StyleValue } from 'vue'

defineProps<{
  runtimePanelStyle: StyleValue
}>()
</script>

<template>
  <aside
    data-testid="app-loading-skeleton"
    class="flex w-[380px] min-w-[380px] max-w-[380px] shrink-0 animate-pulse flex-col bg-background shadow-[inset_-1px_0_0_0_var(--border)]"
    aria-label="应用加载中"
    aria-busy="true"
  >
    <div class="space-y-2.5 p-3 shadow-[inset_0_-1px_0_0_var(--border)]">
      <div class="flex items-start justify-between gap-3 px-1">
        <div class="min-w-0 flex-1 space-y-2">
          <div class="h-4 w-20 rounded bg-secondary/80" />
          <div class="h-3 w-28 rounded bg-secondary/60" />
        </div>
        <div class="h-7 w-7 shrink-0 rounded-md bg-secondary/70 shadow-[var(--shadow-border)]" />
      </div>

      <div class="flex items-center gap-2">
        <div class="h-8 flex-1 rounded-md bg-secondary/60 shadow-[var(--shadow-border)]" />
        <div class="grid h-8 w-[8.5rem] shrink-0 grid-cols-4 gap-1">
          <div
            v-for="index in 4"
            :key="`filter-skeleton-${index}`"
            class="rounded-md bg-secondary/60 shadow-[var(--shadow-border)]"
          />
        </div>
      </div>
    </div>

    <div class="flex-1 space-y-1 overflow-hidden px-2 py-2">
      <div
        v-for="index in 7"
        :key="`app-row-skeleton-${index}`"
        class="flex gap-2 rounded-md px-2 py-2"
      >
        <div class="h-7 w-7 shrink-0 rounded-md bg-secondary/70" />
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex items-center justify-between gap-3">
            <div class="h-3.5 rounded bg-secondary/80" :class="index % 3 === 0 ? 'w-32' : 'w-24'" />
            <div class="h-6 w-14 shrink-0 rounded-md bg-secondary/60" />
          </div>
          <div class="flex gap-1.5">
            <div class="h-3 w-12 rounded-full bg-secondary/60" />
            <div class="h-3 w-16 rounded bg-secondary/50" />
          </div>
          <div class="h-2.5 rounded bg-secondary/50" :class="index % 2 === 0 ? 'w-44' : 'w-36'" />
        </div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-1.5 p-2 shadow-[inset_0_1px_0_0_var(--border)]">
      <div
        v-for="index in 3"
        :key="`sidebar-action-skeleton-${index}`"
        class="h-8 rounded-md bg-secondary/60"
      />
    </div>
  </aside>

  <div
    class="relative z-10 flex w-2 shrink-0 justify-center bg-background"
    aria-hidden="true"
  >
    <span class="h-full w-px bg-border" />
  </div>

  <aside
    class="flex shrink-0 animate-pulse flex-col bg-background"
    :style="runtimePanelStyle"
    aria-hidden="true"
  >
    <div class="p-3 shadow-[inset_0_-1px_0_0_var(--border)]">
      <div class="grid grid-cols-2 gap-1.5">
        <div
          v-for="index in 2"
          :key="`runtime-summary-skeleton-${index}`"
          class="rounded-md bg-card px-2.5 py-2 shadow-[var(--shadow-border)]"
        >
          <div class="h-2.5 w-12 rounded bg-secondary/70" />
          <div class="mt-2 h-5 w-8 rounded bg-secondary/60" />
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 space-y-5 overflow-hidden p-3">
      <section
        v-for="section in 3"
        :key="`runtime-section-skeleton-${section}`"
        class="space-y-2"
      >
        <div class="flex items-center gap-1.5">
          <div class="h-3.5 w-3.5 rounded bg-secondary/70" />
          <div class="h-3 w-16 rounded bg-secondary/70" />
        </div>
        <div class="space-y-1.5">
          <div
            v-for="row in section === 1 ? 2 : 3"
            :key="`runtime-row-skeleton-${section}-${row}`"
            class="rounded-md px-2.5 py-2 shadow-[var(--shadow-border)]"
          >
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex justify-between gap-3">
                  <div class="h-3 w-24 rounded bg-secondary/70" />
                  <div class="h-3 w-12 shrink-0 rounded bg-secondary/50" />
                </div>
                <div class="h-2.5 w-40 rounded bg-secondary/50" />
                <div class="h-2.5 w-28 rounded bg-secondary/40" />
              </div>
              <div class="h-6 w-10 shrink-0 rounded-md bg-secondary/50" />
            </div>
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>
