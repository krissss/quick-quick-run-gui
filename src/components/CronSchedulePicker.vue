<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type CronMode = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
type InputValue = string | number | undefined

interface ParsedCron {
  mode: CronMode
  interval: number
  minute: number
  hour: number
  weekday: number
  dayOfMonth: number
  custom: string
}

const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectedMode = ref<CronMode | null>(null)
let lastEmittedValue = ''

const parsed = computed(() => parseCron(props.modelValue))
const activeMode = computed(() => selectedMode.value ?? parsed.value.mode)

watch(() => props.modelValue, (value) => {
  if (value !== lastEmittedValue) {
    selectedMode.value = null
  }
})

function parseCron(value: string): ParsedCron {
  const fallback: ParsedCron = {
    mode: 'custom',
    interval: 15,
    minute: 0,
    hour: 9,
    weekday: 1,
    dayOfMonth: 1,
    custom: value,
  }

  const parts = value.trim().split(/\s+/)
  if (parts.length !== 5) return fallback

  const [minute, hour, dayOfMonth, month, weekday] = parts
  const singleMinute = parseNumber(minute, 0, 59)
  const singleHour = parseNumber(hour, 0, 23)
  const singleDay = parseNumber(dayOfMonth, 1, 31)
  const singleWeekday = normalizeWeekday(parseNumber(weekday, 0, 7))
  const interval = minute.startsWith('*/') ? parseNumber(minute.slice(2), 1, 59) : null

  if (interval != null && hour === '*' && dayOfMonth === '*' && month === '*' && weekday === '*') {
    return { ...fallback, mode: 'minutes', interval }
  }
  if (singleMinute != null && hour === '*' && dayOfMonth === '*' && month === '*' && weekday === '*') {
    return { ...fallback, mode: 'hourly', minute: singleMinute }
  }
  if (singleMinute != null && singleHour != null && dayOfMonth === '*' && month === '*' && weekday === '*') {
    return { ...fallback, mode: 'daily', minute: singleMinute, hour: singleHour }
  }
  if (singleMinute != null && singleHour != null && dayOfMonth === '*' && month === '*' && singleWeekday != null) {
    return { ...fallback, mode: 'weekly', minute: singleMinute, hour: singleHour, weekday: singleWeekday }
  }
  if (singleMinute != null && singleHour != null && singleDay != null && month === '*' && weekday === '*') {
    return { ...fallback, mode: 'monthly', minute: singleMinute, hour: singleHour, dayOfMonth: singleDay }
  }

  return fallback
}

function parseNumber(value: string, min: number, max: number) {
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  if (number < min || number > max) return null
  return number
}

function normalizeWeekday(value: number | null) {
  if (value == null) return null
  return value === 0 ? 7 : value
}

function clampNumber(value: InputValue, fallback: number, min: number, max: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function emitCron(value: string) {
  lastEmittedValue = value
  emit('update:modelValue', value)
}

function buildCron(mode: CronMode, overrides: Partial<ParsedCron> = {}) {
  const next = { ...parsed.value, ...overrides }
  if (mode === 'minutes') return `*/${next.interval} * * * *`
  if (mode === 'hourly') return `${next.minute} * * * *`
  if (mode === 'daily') return `${next.minute} ${next.hour} * * *`
  if (mode === 'weekly') return `${next.minute} ${next.hour} * * ${next.weekday}`
  if (mode === 'monthly') return `${next.minute} ${next.hour} ${next.dayOfMonth} * *`
  return next.custom
}

function updateMode(value: string | string[]) {
  if (Array.isArray(value) || !isCronMode(value)) return
  selectedMode.value = value
  if (value === 'custom') return
  emitCron(buildCron(value))
}

function isCronMode(value: string): value is CronMode {
  return ['minutes', 'hourly', 'daily', 'weekly', 'monthly', 'custom'].includes(value)
}

function updateInterval(value: InputValue) {
  emitCron(buildCron('minutes', {
    mode: 'minutes',
    interval: clampNumber(value, parsed.value.interval, 1, 59),
  }))
}

function updateMinute(value: InputValue) {
  emitCron(buildCron(parsed.value.mode, {
    minute: clampNumber(value, parsed.value.minute, 0, 59),
  }))
}

function updateHour(value: InputValue) {
  emitCron(buildCron(parsed.value.mode, {
    hour: clampNumber(value, parsed.value.hour, 0, 23),
  }))
}

function updateWeekday(value: string | string[]) {
  if (Array.isArray(value) || !value) return
  emitCron(buildCron('weekly', {
    mode: 'weekly',
    weekday: clampNumber(value, parsed.value.weekday, 1, 7),
  }))
}

function updateDayOfMonth(value: InputValue) {
  emitCron(buildCron('monthly', {
    mode: 'monthly',
    dayOfMonth: clampNumber(value, parsed.value.dayOfMonth, 1, 31),
  }))
}
</script>

<template>
  <div class="space-y-3">
    <ToggleGroup
      class="grid w-full grid-cols-3 gap-1"
      :model-value="activeMode"
      type="single"
      aria-label="定时频率"
      @update:model-value="updateMode"
    >
      <ToggleGroupItem value="minutes">分钟</ToggleGroupItem>
      <ToggleGroupItem value="hourly">每小时</ToggleGroupItem>
      <ToggleGroupItem value="daily">每天</ToggleGroupItem>
      <ToggleGroupItem value="weekly">每周</ToggleGroupItem>
      <ToggleGroupItem value="monthly">每月</ToggleGroupItem>
      <ToggleGroupItem value="custom">自定义</ToggleGroupItem>
    </ToggleGroup>

    <div v-if="activeMode === 'minutes'" class="grid grid-cols-[1fr_auto] items-end gap-2">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">间隔</label>
        <Input
          :model-value="parsed.interval"
          type="number"
          min="1"
          max="59"
          @update:model-value="updateInterval"
        />
      </div>
      <div class="h-9 rounded-md bg-secondary px-3 text-sm leading-9 text-muted-foreground">
        分钟
      </div>
    </div>

    <div v-else-if="activeMode === 'hourly'" class="space-y-1.5">
      <label class="text-xs font-medium text-muted-foreground">每小时第几分钟</label>
      <Input
        :model-value="parsed.minute"
        type="number"
        min="0"
        max="59"
        @update:model-value="updateMinute"
      />
    </div>

    <div v-else-if="activeMode === 'daily'" class="grid grid-cols-2 gap-2">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">小时</label>
        <Input :model-value="parsed.hour" type="number" min="0" max="23" @update:model-value="updateHour" />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">分钟</label>
        <Input :model-value="parsed.minute" type="number" min="0" max="59" @update:model-value="updateMinute" />
      </div>
    </div>

    <div v-else-if="activeMode === 'weekly'" class="space-y-3">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">星期</label>
        <ToggleGroup
          class="grid w-full grid-cols-7 gap-1"
          :model-value="String(parsed.weekday)"
          type="single"
          aria-label="星期"
          @update:model-value="updateWeekday"
        >
          <ToggleGroupItem
            v-for="day in WEEKDAYS"
            :key="day.value"
            class="px-1"
            :value="String(day.value)"
          >
            {{ day.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">小时</label>
          <Input :model-value="parsed.hour" type="number" min="0" max="23" @update:model-value="updateHour" />
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-muted-foreground">分钟</label>
          <Input :model-value="parsed.minute" type="number" min="0" max="59" @update:model-value="updateMinute" />
        </div>
      </div>
    </div>

    <div v-else-if="activeMode === 'monthly'" class="grid grid-cols-3 gap-2">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">日期</label>
        <Input :model-value="parsed.dayOfMonth" type="number" min="1" max="31" @update:model-value="updateDayOfMonth" />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">小时</label>
        <Input :model-value="parsed.hour" type="number" min="0" max="23" @update:model-value="updateHour" />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground">分钟</label>
        <Input :model-value="parsed.minute" type="number" min="0" max="59" @update:model-value="updateMinute" />
      </div>
    </div>

    <div v-else class="space-y-1.5">
      <label class="text-xs font-medium text-muted-foreground">Cron</label>
      <Input
        :model-value="modelValue"
        class="font-mono"
        placeholder="*/15 * * * *"
        @update:model-value="(value) => emitCron(value == null ? '' : String(value))"
      />
    </div>

    <div class="rounded-md bg-secondary px-3 py-2 font-mono text-xs text-muted-foreground">
      {{ modelValue || '0 9 * * *' }}
    </div>
  </div>
</template>
