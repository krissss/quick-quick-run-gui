import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useAppFavicons } from '@/composables/useAppFavicons'
import { webApp } from '../../fixtures/apps'
import { setupTauriMocks } from '../../helpers/tauri'

function mountHarness(faviconResolver: (url: string) => string | null) {
  setupTauriMocks({ faviconResolver })

  return mount(defineComponent({
    setup() {
      const apps = ref([webApp])
      const runningAppIds = ref<ReadonlySet<string>>(new Set())
      const { faviconUrl, markFaviconFailed } = useAppFavicons(apps, runningAppIds)
      return { apps, faviconUrl, markFaviconFailed, runningAppIds }
    },
    render() {
      const app = this.apps[0]
      const url = this.faviconUrl(app)
      return h('div', [
        url
          ? h('img', {
              alt: `${app.name} favicon`,
              src: url,
              onError: () => this.markFaviconFailed(app),
            })
          : null,
      ])
    },
  }))
}

describe('useAppFavicons', () => {
  it('shares favicon loading state and retries when a web app starts running', async () => {
    let ready = false
    const wrapper = mountHarness(() => ready ? 'http://localhost:3000/ready-icon.png' : null)

    await flushPromises()
    const img = () => wrapper.find('img[alt="demo-web favicon"]')
    expect(img().attributes('src')).toBe('http://localhost:3000/favicon.ico')

    await img().trigger('error')
    expect(img().exists()).toBe(false)

    ready = true
    wrapper.vm.runningAppIds = new Set(['web-1'])
    await flushPromises()

    expect(img().attributes('src')).toBe('http://localhost:3000/ready-icon.png')
  })
})
