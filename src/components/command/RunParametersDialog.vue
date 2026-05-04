<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  buildCommandWithProfile,
  parseCommandSignature,
  type AppItem,
  type AppProfile,
  type CommandParam,
} from '@/lib/store'

type MessageType = 'success' | 'error' | 'info'

const props = defineProps<{
  open: boolean
  app: AppItem | null
  persistProfiles: (app: AppItem, profiles: AppProfile[], activeProfileId: string) => Promise<AppItem | void>
}>()

const emit = defineEmits<{
  close: []
  launch: [app: AppItem]
  message: [text: string, type?: MessageType]
}>()

const currentApp = ref<AppItem | null>(null)
const selectedProfileId = ref('')
const profileNameDraft = ref('')
const values = ref<Record<string, string>>({})

const commandParams = computed(() =>
  currentApp.value ? parseCommandSignature(currentApp.value.command).params : [],
)
const selectedProfile = computed(() =>
  currentApp.value?.profiles.find(profile => profile.id === selectedProfileId.value) || null,
)
const previewCommand = computed(() =>
  currentApp.value ? buildCommandWithProfile(currentApp.value.command, values.value) : '',
)

function cloneApp(app: AppItem): AppItem {
  return {
    ...app,
    profiles: app.profiles.map(profile => ({
      ...profile,
      values: { ...profile.values },
    })),
  }
}

function itemTypeLabel(type: AppItem['type']) {
  if (type === 'task') return '任务'
  if (type === 'service') return '服务'
  return '网页'
}

function createProfileId() {
  return crypto.randomUUID?.() || `profile-${Date.now()}`
}

function commandParamDisplay(param: CommandParam) {
  return param.kind === 'option' ? `--${param.key}` : `{${param.key}}`
}

function commandParamsFor(app: AppItem) {
  return parseCommandSignature(app.command).params
}

function valuesForProfile(app: AppItem, profileId: string) {
  const profile = app.profiles.find(item => item.id === profileId)
  return Object.fromEntries(
    commandParamsFor(app).map(param => [param.key, profile?.values?.[param.key] ?? param.default]),
  )
}

function initialize(app: AppItem) {
  const nextApp = cloneApp(app)
  currentApp.value = nextApp
  selectedProfileId.value = nextApp.activeProfileId || ''
  values.value = valuesForProfile(nextApp, selectedProfileId.value)
  profileNameDraft.value = selectedProfile.value?.name || ''
}

function reset() {
  currentApp.value = null
  selectedProfileId.value = ''
  profileNameDraft.value = ''
  values.value = {}
}

watch(
  [() => props.open, () => props.app],
  ([open, app]) => {
    if (open && app) {
      initialize(app)
    } else if (!open) {
      reset()
    }
  },
  { immediate: true },
)

function closeDialog() {
  emit('close')
}

function selectProfile(profileId: string) {
  const app = currentApp.value
  if (!app) return
  selectedProfileId.value = profileId
  values.value = valuesForProfile(app, profileId)
  profileNameDraft.value = selectedProfile.value?.name || ''
}

function runParamValue(param: CommandParam) {
  return values.value[param.key] ?? param.default
}

function setRunParamValue(param: CommandParam, value: string | boolean) {
  values.value = {
    ...values.value,
    [param.key]: typeof value === 'boolean' ? String(value) : value,
  }
}

function runBoolValue(param: CommandParam) {
  return ['true', '1', 'yes'].includes(runParamValue(param).trim().toLowerCase())
}

function uniqueProfileName(app: AppItem, name: string) {
  const existing = new Set(app.profiles.map(profile => profile.name.trim()).filter(Boolean))
  if (!existing.has(name)) return name
  let index = 2
  let candidate = `${name} ${index}`
  while (existing.has(candidate)) {
    index += 1
    candidate = `${name} ${index}`
  }
  return candidate
}

async function persistProfileChanges(profiles: AppProfile[], activeProfileId: string) {
  const app = currentApp.value
  if (!app) return
  const persisted = await props.persistProfiles(app, profiles, activeProfileId)
  currentApp.value = cloneApp(persisted || { ...app, profiles, activeProfileId })
  selectedProfileId.value = activeProfileId
}

async function saveDraftAsProfile() {
  const app = currentApp.value
  if (!app || commandParams.value.length === 0) return
  const name = uniqueProfileName(app, profileNameDraft.value.trim() || `方案 ${app.profiles.length + 1}`)
  const profile: AppProfile = {
    id: createProfileId(),
    name,
    values: { ...values.value },
  }

  await persistProfileChanges([...app.profiles, profile], profile.id)
  profileNameDraft.value = profile.name
  emit('message', '已保存运行方案', 'success')
}

async function updateSelectedProfile() {
  const app = currentApp.value
  const profile = selectedProfile.value
  if (!app || !profile) return
  const nextProfiles = app.profiles.map(item =>
    item.id === profile.id
      ? {
          ...item,
          name: profileNameDraft.value.trim() || item.name || '未命名方案',
          values: { ...values.value },
        }
      : item,
  )
  await persistProfileChanges(nextProfiles, profile.id)
  emit('message', '已更新运行方案', 'success')
}

async function deleteSelectedProfile() {
  const app = currentApp.value
  const profile = selectedProfile.value
  if (!app || !profile) return
  const nextProfiles = app.profiles.filter(item => item.id !== profile.id)
  const nextApp = { ...app, profiles: nextProfiles, activeProfileId: '' }
  await persistProfileChanges(nextProfiles, '')
  values.value = valuesForProfile(nextApp, '')
  profileNameDraft.value = ''
  emit('message', '已删除运行方案', 'success')
}

function launchDraft() {
  const app = currentApp.value
  if (!app) return
  const draftProfileId = '__run-draft__'
  const launchTarget: AppItem = {
    ...app,
    activeProfileId: draftProfileId,
    profiles: [
      ...app.profiles.filter(profile => profile.id !== draftProfileId),
      {
        id: draftProfileId,
        name: selectedProfile.value?.name || '临时运行',
        values: { ...values.value },
      },
    ],
  }
  emit('close')
  emit('launch', launchTarget)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && currentApp"
      class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      @click.self="closeDialog"
    >
      <div class="bg-card rounded-lg p-6 w-full max-w-2xl max-h-[88vh] overflow-y-auto space-y-5" style="box-shadow: var(--shadow-card)">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-xs font-medium text-muted-foreground">{{ itemTypeLabel(currentApp.type) }} / 运行参数</div>
            <h2 class="mt-1 truncate text-base font-semibold tracking-[-0.32px]">{{ currentApp.name }}</h2>
          </div>
          <Button variant="ghost" size="sm" class="h-8 w-8 px-0 shrink-0" aria-label="关闭运行参数" @click="closeDialog">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </Button>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-medium text-muted-foreground">方案</label>
            <span class="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {{ selectedProfile ? (selectedProfile.name || '未命名方案') : '临时运行' }}
            </span>
          </div>
          <div class="flex flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              :variant="!selectedProfileId ? 'secondary' : 'ghost'"
              class="h-7 px-2 text-xs"
              @click="selectProfile('')"
            >
              默认
            </Button>
            <Button
              v-for="profile in currentApp.profiles"
              :key="profile.id"
              type="button"
              size="sm"
              :variant="selectedProfileId === profile.id ? 'secondary' : 'ghost'"
              class="h-7 px-2 text-xs"
              @click="selectProfile(profile.id)"
            >
              {{ profile.name || '未命名方案' }}
            </Button>
          </div>
        </div>

        <div class="space-y-1">
          <div
            v-for="param in commandParams"
            :key="param.key"
            class="grid gap-2 py-3 shadow-[inset_0_-1px_0_0_var(--border)] last:shadow-none sm:grid-cols-[minmax(0,1fr)_minmax(180px,1.2fr)] sm:items-center"
          >
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{{ param.label }}</div>
              <div class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {{ commandParamDisplay(param) }}
              </div>
            </div>
            <Switch
              v-if="param.type === 'bool'"
              :model-value="runBoolValue(param)"
              @update:model-value="setRunParamValue(param, $event)"
            />
            <Input
              v-else
              class="h-8 text-xs"
              :placeholder="param.default || param.label"
              :model-value="runParamValue(param)"
              @update:model-value="setRunParamValue(param, String($event ?? ''))"
            />
          </div>
        </div>

        <div class="space-y-2 rounded-md bg-secondary/60 p-3" style="box-shadow: var(--shadow-border)">
          <div class="flex items-center justify-between gap-3">
            <label class="text-xs font-medium text-muted-foreground">方案名称</label>
            <Button
              v-if="selectedProfile"
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 w-7 shrink-0 px-0 text-muted-foreground hover:text-destructive"
              title="删除当前方案"
              aria-label="删除当前方案"
              @click="deleteSelectedProfile"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </Button>
          </div>
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Input v-model="profileNameDraft" class="h-8 text-xs" placeholder="保存为方案名称" />
            <Button
              v-if="selectedProfile"
              type="button"
              size="sm"
              class="shrink-0"
              @click="updateSelectedProfile"
            >
              更新方案
            </Button>
            <Button
              type="button"
              :variant="selectedProfile ? 'secondary' : 'default'"
              size="sm"
              class="shrink-0"
              @click="saveDraftAsProfile"
            >
              {{ selectedProfile ? '另存为新方案' : '保存方案' }}
            </Button>
          </div>
        </div>

        <div class="space-y-1.5">
          <div class="text-xs font-medium text-muted-foreground">最终命令</div>
          <div class="max-h-24 overflow-y-auto rounded-md bg-secondary px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground break-all">
            {{ previewCommand || '空命令' }}
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" @click="closeDialog">取消</Button>
          <Button size="sm" @click="launchDraft">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M8 5v14l11-7z" />
            </svg>
            运行
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
