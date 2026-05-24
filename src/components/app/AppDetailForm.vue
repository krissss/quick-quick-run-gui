<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import AppCapabilityStack from '@/components/app/capabilities/AppCapabilityStack.vue'
import type { AppItem } from '@/lib/store'
import { useAppSessionStore } from '@/stores/appSession'
import { useAppsStore } from '@/stores/apps'

const appsStore = useAppsStore()
const sessionStore = useAppSessionStore()
const confirmDeleteOpen = ref(false)
const deletingApp = ref(false)

const editForm = computed<AppItem>({
  get: () => appsStore.editForm,
  set: value => {
    appsStore.updateForm(value)
  },
})
const deleteTargetName = computed(() => editForm.value.name.trim() || '未命名')

function requestDeleteCurrentApp() {
  confirmDeleteOpen.value = true
}

async function deleteCurrentApp() {
  if (deletingApp.value) return
  deletingApp.value = true
  try {
    await appsStore.deleteApp()
    confirmDeleteOpen.value = false
    sessionStore.closeEditDialog()
  } finally {
    deletingApp.value = false
  }
}
</script>

<template>
  <div>
    <div data-testid="app-detail-panel" class="min-h-0">
      <div class="px-5 py-5">
        <AppCapabilityStack
          v-model="editForm"
          @set-type="appsStore.setAppType"
          @set-schedule-enabled="appsStore.setScheduleEnabled"
          @set-schedule-cron="appsStore.setScheduleCron"
          @set-missed-policy="appsStore.setMissedPolicy"
          @set-startup="appsStore.setStartup"
          @set-restart="appsStore.setRestart"
          @set-retry="appsStore.setRetry"
          @choose-working-directory="sessionStore.chooseWorkingDirectory"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2 bg-muted/40 px-5 py-3 shadow-[inset_0_1px_0_0_var(--border)]">
        <Button size="sm" @click="sessionStore.saveAndCloseEditDialog">{{ appsStore.isNew ? '添加' : '保存' }}</Button>
        <Button
          v-if="!appsStore.isNew"
          variant="secondary"
          size="sm"
          @click="sessionStore.duplicateSelectedApp"
        >
          <Copy :size="14" :stroke-width="2" aria-hidden="true" />
          复制
        </Button>
        <div class="flex-1" />
        <Button v-if="!appsStore.isNew" variant="destructive" size="sm" @click="requestDeleteCurrentApp">删除</Button>
      </div>
    </div>

    <AlertDialog
      :open="confirmDeleteOpen"
      @update:open="(value) => { if (!value && !deletingApp) confirmDeleteOpen = false }"
    >
      <AlertDialogContent class="w-[min(calc(100vw-2rem),32rem)] border-0 bg-card p-0 shadow-[var(--shadow-card)]">
        <div class="px-5 pt-5">
          <AlertDialogHeader>
            <AlertDialogTitle class="text-base tracking-[-0.32px]">确认删除应用</AlertDialogTitle>
            <AlertDialogDescription class="leading-6">
              将删除「{{ deleteTargetName }}」。这个操作会立即保存到应用列表。
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        <AlertDialogFooter class="bg-muted/40 px-5 py-3 shadow-[inset_0_1px_0_0_var(--border)]">
          <Button
            type="button"
            variant="outline"
            class="mt-0"
            :disabled="deletingApp"
            @click="confirmDeleteOpen = false"
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            class="bg-destructive/10 text-destructive hover:bg-destructive/20"
            :disabled="deletingApp"
            @click="deleteCurrentApp"
          >
            {{ deletingApp ? '删除中' : '确认删除' }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
