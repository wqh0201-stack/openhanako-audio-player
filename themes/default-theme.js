/**
 * default-theme.js
 * 默认歌词视觉主题
 * 
 * 纯CSS实现，无Canvas/WebGL依赖，兼容所有设备
 */

const defaultTheme = {
  id: 'default-theme',
  name: '默认主题',
  description: '基础歌词显示，兼容所有设备',
  version: '1.0.0',
  author: '奥菲莉娅',
  
  // 性能要求
  requirements: {
    minTier: 'low',
    features: [],
  },
  
  // 渲染器
  renderer: {
    type: 'css',
    container: null,
    settings: null,
    
    /**
     * 初始化渲染器
     * @param {HTMLElement} container
     * @param {object} settings
     */
    init(container, settings) {
      this.container = container;
      this.settings = settings;
      
      // 创建歌词容器
      this.lyricsContainer = document.createElement('div');
      this.lyricsContainer.className = 'lyrics-container default-theme';
      this.lyricsContainer.style.cssText = `
        font-size: ${settings.fontSize || 16}px;
        line-height: ${settings.lineHeight || 1.8};
        color: ${settings.text || '#e0e0e0'};
        padding: ${settings.padding || 16}px;
        text-align: center;
        overflow-y: auto;
        max-height: 100%;
      `;
      
      this.container.appendChild(this.lyricsContainer);
    },
    
    /**
     * 渲染歌词
     * @param {object} state
     */
    render(state) {
      if (!this.lyricsContainer) return;
      
      const { lines, currentLine, highlightColor } = state;
      
      // 清空容器
      this.lyricsContainer.innerHTML = '';
      
      // 渲染每一行歌词
      lines.forEach((line, index) => {
        const lineElement = document.createElement('div');
        lineElement.className = 'lyric-line';
        lineElement.textContent = line.text;
        
        // 高亮当前行
        if (index === currentLine) {
          lineElement.style.cssText = `
            color: ${highlightColor || this.settings.highlight || '#d49a6a'};
            font-weight: bold;
            font-size: ${(this.settings.fontSize || 16) * 1.1}px;
            transition: all 0.3s ease;
          `;
        } else {
          lineElement.style.cssText = `
            color: ${this.settings.text || '#e0e0e0'};
            opacity: ${index < currentLine ? 0.5 : 0.8};
            transition: all 0.3s ease;
          `;
        }
        
        this.lyricsContainer.appendChild(lineElement);
      });
      
      // 滚动到当前行
      if (currentLine >= 0 && currentLine < lines.length) {
        const currentElement = this.lyricsContainer.children[currentLine];
        if (currentElement) {
          currentElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      }
    },
    
    /**
     * 销毁渲染器
     */
    destroy() {
      if (this.lyricsContainer) {
        this.lyricsContainer.remove();
        this.lyricsContainer = null;
      }
    },
  },
  
  // 设置Schema
  settingsSchema: {
    type: 'object',
    properties: {
      fontSize: {
        type: 'number',
        default: 16,
        title: '字号',
        minimum: 12,
        maximum: 24,
      },
      lineHeight: {
        type: 'number',
        default: 1.8,
        title: '行高',
        minimum: 1.2,
        maximum: 2.5,
      },
      text: {
        type: 'string',
        default: '#e0e0e0',
        title: '文字颜色',
        format: 'color',
      },
      highlight: {
        type: 'string',
        default: '#d49a6a',
        title: '高亮颜色',
        format: 'color',
      },
      padding: {
        type: 'number',
        default: 16,
        title: '内边距',
        minimum: 8,
        maximum: 32,
      },
    },
  },
  
  // 默认设置
  defaultSettings: {
    fontSize: 16,
    lineHeight: 1.8,
    text: '#e0e0e0',
    highlight: '#d49a6a',
    padding: 16,
  },
  
  // Fallback主题ID（自身是最终fallback）
  fallback: null,
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = defaultTheme;
} else if (typeof window !== 'undefined') {
  window.defaultTheme = defaultTheme;
}