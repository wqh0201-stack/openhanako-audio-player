/**
 * waveform-theme.js
 * 波形歌词视觉主题
 * 
 * Canvas实现，显示音频波形，中性能档位
 */

const waveformTheme = {
  id: 'waveform-theme',
  name: '波形主题',
  description: '歌词与音频波形同步显示',
  version: '1.0.0',
  author: '奥菲莉娅',
  
  // 性能要求
  requirements: {
    minTier: 'medium',
    features: ['canvas'],
  },
  
  // 渲染器
  renderer: {
    type: 'canvas',
    container: null,
    settings: null,
    canvas: null,
    ctx: null,
    animationId: null,
    waveformData: [],
    
    /**
     * 初始化渲染器
     * @param {HTMLElement} container
     * @param {object} settings
     */
    init(container, settings) {
      this.container = container;
      this.settings = settings;
      
      // 创建Canvas元素
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'waveform-canvas';
      this.canvas.style.cssText = `
        width: 100%;
        height: ${settings.waveHeight || 60}px;
        display: block;
      `;
      this.container.appendChild(this.canvas);
      
      // 获取上下文
      this.ctx = this.canvas.getContext('2d');
      
      // 创建歌词容器
      this.lyricsContainer = document.createElement('div');
      this.lyricsContainer.className = 'lyrics-container waveform-theme';
      this.lyricsContainer.style.cssText = `
        font-size: ${settings.fontSize || 16}px;
        line-height: ${settings.lineHeight || 1.8};
        color: ${settings.lyricColor || '#d49a6a'};
        padding: ${settings.padding || 16}px;
        text-align: center;
        overflow-y: auto;
        max-height: calc(100% - ${settings.waveHeight || 60}px);
      `;
      this.container.appendChild(this.lyricsContainer);
      
      // 初始化波形数据
      this.waveformData = new Array(64).fill(0);
      
      // 调整Canvas大小
      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());
    },
    
    /**
     * 调整Canvas大小
     */
    resizeCanvas() {
      if (!this.canvas) return;
      
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * window.devicePixelRatio;
      this.canvas.height = rect.height * window.devicePixelRatio;
      this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    },
    
    /**
     * 渲染歌词和波形
     * @param {object} state
     */
    render(state) {
      if (!this.ctx || !this.lyricsContainer) return;
      
      const { lines, currentLine, waveData } = state;
      
      // 更新波形数据
      if (waveData && waveData.length > 0) {
        this.waveformData = waveData;
      }
      
      // 清空Canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      
      // 绘制波形
      this.drawWaveform();
      
      // 渲染歌词
      this.renderLyrics(lines, currentLine);
    },
    
    /**
     * 绘制波形
     */
    drawWaveform() {
      const { width, height } = this.canvas.getBoundingClientRect();
      const barWidth = width / this.waveformData.length;
      const waveColor = this.settings.waveColor || '#4ade80';
      
      this.ctx.fillStyle = waveColor;
      
      this.waveformData.forEach((value, index) => {
        const barHeight = value * height * 0.8;
        const x = index * barWidth;
        const y = (height - barHeight) / 2;
        
        this.ctx.fillRect(x, y, barWidth - 1, barHeight);
      });
    },
    
    /**
     * 渲染歌词
     * @param {Array} lines
     * @param {number} currentLine
     */
    renderLyrics(lines, currentLine) {
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
            color: ${this.settings.lyricColor || '#d49a6a'};
            font-weight: bold;
            font-size: ${(this.settings.fontSize || 16) * 1.1}px;
            transition: all 0.3s ease;
          `;
        } else {
          lineElement.style.cssText = `
            color: ${this.settings.lyricColor || '#d49a6a'};
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
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
      
      if (this.canvas) {
        this.canvas.remove();
        this.canvas = null;
      }
      
      if (this.lyricsContainer) {
        this.lyricsContainer.remove();
        this.lyricsContainer = null;
      }
      
      window.removeEventListener('resize', this.resizeCanvas);
    },
  },
  
  // 设置Schema
  settingsSchema: {
    type: 'object',
    properties: {
      waveColor: {
        type: 'string',
        default: '#4ade80',
        title: '波形颜色',
        format: 'color',
      },
      lyricColor: {
        type: 'string',
        default: '#d49a6a',
        title: '歌词颜色',
        format: 'color',
      },
      waveHeight: {
        type: 'number',
        default: 60,
        title: '波形高度',
        minimum: 30,
        maximum: 120,
      },
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
    waveColor: '#4ade80',
    lyricColor: '#d49a6a',
    waveHeight: 60,
    fontSize: 16,
    lineHeight: 1.8,
    padding: 16,
  },
  
  // Fallback主题ID
  fallback: 'default-theme',
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = waveformTheme;
} else if (typeof window !== 'undefined') {
  window.waveformTheme = waveformTheme;
}