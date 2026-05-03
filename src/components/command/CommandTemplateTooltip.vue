<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
          aria-label="查看命令模板说明"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" class="max-w-[300px]">
        <div class="space-y-1.5">
          <p>支持完整 shell 语法，包括 <span class="font-mono">&&</span>、管道、环境变量。</p>
          <p><span class="font-mono">{name= : 名称}</span> 会作为位置参数替换。</p>
          <p><span class="font-mono">{--debug}</span> 是开关参数，<span class="font-mono">{--account= : 账号}</span> 会生成 <span class="font-mono">--account=值</span>。</p>
          <p>带模板的命令启动时会打开运行参数面板，可临时修改、另存或更新方案。</p>
          <p>工作目录请在下方单独设置。</p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
