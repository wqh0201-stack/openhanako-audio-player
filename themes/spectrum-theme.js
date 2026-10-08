/**
 * spectrum-theme.js
 * 频谱歌词视觉主题
 * 
 * WebGL实现，实时频谱分析，高性能档位
 */

const spectrumTheme = {
  id: 'spectrum-theme',
  name: '频谱主题',
  description: '实时频谱分析与歌词同步',
  version: '1.0.0',
  author: '奥菲莉娅',
  
  // 性能要求
  requirements: {
    minTier: 'high',
    features: ['webgl'],
  },
  
  // 渲染器
  renderer: {
    type: 'webgl',
    container: null,
    settings: null,
    canvas: null,
    gl: null,
    animationId: null,
    spectrumData: [],
    
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
      this.canvas.className = 'spectrum-canvas';
      this.canvas.style.cssText = `
        width: 100%;
        height: 100%;
        display: block;
      `;
      this.container.appendChild(this.canvas);
      
      // 获取WebGL上下文
      this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
      
      if (!this.gl) {
        console.error('WebGL not supported, falling back to default theme');
        return;
      }
      
      // 初始化WebGL
      this.initWebGL();
      
      // 创建歌词容器
      this.lyricsContainer = document.createElement('div');
      this.lyricsContainer.className = 'lyrics-container spectrum-theme';
      this.lyricsContainer.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        font-size: ${settings.fontSize || 16}px;
        line-height: ${settings.lineHeight || 1.8};
        color: ${settings.lyricColor || '#d49a6a'};
        padding: ${settings.padding || 16}px;
        text-align: center;
        background: linear-gradient(transparent, rgba(0,0,0,0.7));
        max-height: 40%;
        overflow-y: auto;
      `;
      this.container.appendChild(this.lyricsContainer);
      
      // 初始化频谱数据
      this.spectrumData = new Array(settings.barCount || 64).fill(0);
      
      // 调整Canvas大小
      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());
    },
    
    /**
     * 初始化WebGL
     */
    initWebGL() {
      const gl = this.gl;
      
      // 着色器源码
      const vertexShaderSource = `
        attribute vec2 a_position;
        attribute float a_height;
        uniform vec2 u_resolution;
        varying float v_height;
        
        void main() {
          vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
          gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
          v_height = a_height;
        }
      `;
      
      const fragmentShaderSource = `
        precision mediump float;
        uniform vec3 u_color;
        varying float v_height;
        
        void main() {
          gl_FragColor = vec4(u_color * v_height, 1.0);
        }
      `;
      
      // 编译着色器
      const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
      
      // 创建程序
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertexShader);
      gl.attachShader(this.program, fragmentShader);
      gl.linkProgram(this.program);
      
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error('Program link failed:', gl.getProgramInfoLog(this.program));
        return;
      }
      
      // 获取属性位置
      this.positionLocation = gl.getAttribLocation(this.program, 'a_position');
      this.heightLocation = gl.getAttribLocation(this.program, 'a_height');
      this.resolutionLocation = gl.getUniformLocation(this.program, 'u_resolution');
      this.colorLocation = gl.getUniformLocation(this.program, 'u_color');
      
      // 创建缓冲区
      this.positionBuffer = gl.createBuffer();
      this.heightBuffer = gl.createBuffer();
    },
    
    /**
     * 编译着色器
     * @param {number} type
     * @param {string} source
     * @returns {WebGLShader}
     */
    compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      
      return shader;
    },
    
    /**
     * 调整Canvas大小
     */
    resizeCanvas() {
      if (!this.canvas || !this.gl) return;
      
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = rect.width * window.devicePixelRatio;
      this.canvas.height = rect.height * window.devicePixelRatio;
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    },
    
    /**
     * 渲染歌词和频谱
     * @param {object} state
     */
    render(state) {
      if (!this.gl || !this.lyricsContainer) return;
      
      const { lines, currentLine, spectrumData } = state;
      
      // 更新频谱数据
      if (spectrumData && spectrumData.length > 0) {
        this.spectrumData = spectrumData;
      }
      
      // 绘制频谱
      this.drawSpectrum();
      
      // 渲染歌词
      this.renderLyrics(lines, currentLine);
    },
    
    /**
     * 绘制频谱
     */
    drawSpectrum() {
      const gl = this.gl;
      const { width, height } = this.canvas.getBoundingClientRect();
      
      // 清空画布
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      
      gl.useProgram(this.program);
      
      // 设置分辨率
      gl.uniform2f(this.resolutionLocation, width, height);
      
      // 设置颜色
      const color = this.hexToRgb(this.settings.spectrumColor || '#818cf8');
      gl.uniform3f(this.colorLocation, color.r, color.g, color.b);
      
      // 计算顶点位置
      const barWidth = width / this.spectrumData.length;
      const positions = [];
      const heights = [];
      
      this.spectrumData.forEach((value, index) => {
        const x = index * barWidth;
        const barHeight = value * height * 0.8;
        
        // 矩形顶点（两个三角形）
        positions.push(
          x, height - barHeight,
          x + barWidth - 1, height - barHeight,
          x, height,
          x, height,
          x + barWidth - 1, height - barHeight,
          x + barWidth - 1, height
        );
        
        // 高度值
        heights.push(value, value, value, value, value, value);
      });
      
      // 更新位置缓冲区
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.positionLocation);
      gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
      
      // 更新高度缓冲区
      gl.bindBuffer(gl.ARRAY_BUFFER, this.heightBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(heights), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.heightLocation);
      gl.vertexAttribPointer(this.heightLocation, 1, gl.FLOAT, false, 0, 0);
      
      // 绘制
      gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2);
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
            text-shadow: 0 0 10px ${this.settings.lyricColor || '#d49a6a'};
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
     * Hex转RGB
     * @param {string} hex
     * @returns {object}
     */
    hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      } : { r: 0.5, g: 0.5, b: 1.0 };
    },
    
    /**
     * 销毁渲染器
     */
    destroy() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
      
      if (this.gl) {
        this.gl.deleteProgram(this.program);
        this.gl.deleteBuffer(this.positionBuffer);
        this.gl.deleteBuffer(this.heightBuffer);
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
      spectrumColor: {
        type: 'string',
        default: '#818cf8',
        title: '频谱颜色',
        format: 'color',
      },
      lyricColor: {
        type: 'string',
        default: '#d49a6a',
        title: '歌词颜色',
        format: 'color',
      },
      barCount: {
        type: 'number',
        default: 64,
        title: '频谱条数',
        minimum: 16,
        maximum: 128,
      },
      sensitivity: {
        type: 'number',
        default: 1.0,
        title: '灵敏度',
        minimum: 0.5,
        maximum: 2.0,
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
    spectrumColor: '#818cf8',
    lyricColor: '#d49a6a',
    barCount: 64,
    sensitivity: 1.0,
    fontSize: 16,
    lineHeight: 1.8,
    padding: 16,
  },
  
  // Fallback主题ID
  fallback: 'waveform-theme',
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = spectrumTheme;
} else if (typeof window !== 'undefined') {
  window.spectrumTheme = spectrumTheme;
}