<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { itemTypeLabel } from '@/lib/appDisplay'
import type { AppItem, AppType } from '@/lib/store'

const app = defineModel<AppItem>({ required: true })

const emit = defineEmits<{
  setType: [type: AppType]
}>()

const typeTargets: Array<{ type: AppType, target: string }> = [
  {
    type: 'web',
    target: '打开一个 Web 界面，可选启动后台命令并等待 URL 可达。',
  },
  {
    type: 'service',
    target: '托管长期运行的后台进程，关注启动、停止、日志与恢复。',
  },
  {
    type: 'task',
    target: '执行一次命令，记录结果，并可配置手动或定时触发。',
  },
]

function updateType(value: string | string[]) {
  if (typeof value === 'string' && value) emit('setType', value as AppType)
}
</script>

<template>
  <div class="space-y-1.5">
    <label class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span>类型</span>
      <TooltipProvider :delay-duration="150">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              class="h-4 w-4 rounded-full text-[10px] text-muted-foreground hover:text-foreground"
              aria-label="查看类型目标说明"
            >
              ?
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" class="max-w-[340px]">
            <div class="space-y-1.5">
              <div
                v-for="item in typeTargets"
                :key="item.type"
                class="leading-5"
              >
                <span class="font-medium text-foreground">{{ itemTypeLabel(item.type) }}：</span>
                <span>{{ item.target }}</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </label>
    <ToggleGroup
      class="grid w-full grid-cols-3 gap-1"
      :model-value="app.type"
      type="single"
      @update:model-value="updateType"
    >
      <ToggleGroupItem
        v-for="item in typeTargets"
        :key="item.type"
        :value="item.type"
        :title="item.target"
      >
        {{ itemTypeLabel(item.type) }}
      </ToggleGroupItem>
    </ToggleGroup>
  </div>
</template>
