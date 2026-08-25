// ============================================================
// 无双混战 - 大量敌人 · 连击爽快 · 必杀爆发
// ============================================================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VIEW_W = 1200, VIEW_H = 720;
const MAP_W = 3000, MAP_H = 2000;

// === 工具 ===
const rand = (a,b) => a + Math.random()*(b-a);
const randi = (a,b) => Math.floor(rand(a,b));
const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const angleTo = (a,b) => Math.atan2(b.y-a.y, b.x-a.x);

// === 角色 ===
const CHARS = {
  warrior:  { name:'剑豪',   icon:'🗡', hp:300, speed:3.0, meleeRange:95,  meleeArc:1.6, meleeDmg:55, gunDmg:12, fireRate:300, mag:8,  reload:1200, color:'#f44' },
  gunner:   { name:'枪手',   icon:'🔫', hp:220, speed:3.3, meleeRange:70,  meleeArc:1.2, meleeDmg:30, gunDmg:18, fireRate:80,  mag:30, reload:1600, color:'#4af' },
  berserker:{ name:'狂战士', icon:'🪓', hp:400, speed:2.6, meleeRange:110, meleeArc:2.0, meleeDmg:75, gunDmg:10, fireRate:350, mag:6,  reload:1400, color:'#fa0' }
};

// === 游戏状态 ===
const game = {
  running:false, over:false, time:0,
  score:0, kills:0, wave:1, waveTimer:0, enemiesInWave:0, enemiesSpawned:0,
  combo:0, comboTimer:0, maxCombo:0,
  rage:0, maxRage:100, ultActive:false, ultTimer:0,
  selectedChar:'warrior',
  camera:{x:0,y:0,shake:0},
  keys:{}, mouse:{x:0,y:0,worldX:0,worldY:0,down:false,rightDown:false,leftDown:false,lastLeft:false},
  ent:{ player:null, enemies:[], bullets:[], slashFx:[], particles:[], dmgNums:[], pickups:[], corpses:[] },
  spawnQueue:[], spawnTimer:0
};

// === 日志 ===
function logMsg(txt, color='#faa') {
  const log = document.getElementById('msgLog');
  const d = document.createElement('div');
  d.className = 'log-msg'; d.style.borderLeftColor = color;
  d.style.color = color; d.textContent = txt;
  log.appendChild(d);
  setTimeout(() => d.remove(), 3000);
  while (log.children.length > 5) log.removeChild(log.firstChild);
}

// === 粒子 ===
function spawnParticles(x,y,count,color,speed=4,life=500) {
  for (let i=0;i<count;i++) {
    const a = rand(0, Math.PI*2);
    const s = rand(speed*0.3, speed);
    game.ent.particles.push({x,y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, life, maxLife:life, color, size:rand(2,5)});
  }
}
function spawnBlood(x,y,angle,force=6) {
  for (let i=0;i<8;i++) {
    const a = angle + rand(-0.5,0.5);
    const s = rand(force*0.5, force);
    game.ent.particles.push({x,y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, life:600, maxLife:600, color:'#a22', size:rand(3,6)});
  }
}

// === 伤害数字 ===
function spawnDmgNum(x,y,dmg,color='#fff',crit=false) {
  game.ent.dmgNums.push({x,y, dmg:Math.round(dmg), color, vy:-2.5, life:800, maxLife:800, crit, size:crit?22:14});
}

// === 屏幕震动 ===
function shake(amount) { game.camera.shake = Math.max(game.camera.shake, amount); }

// === 屏幕闪烁 ===
function flashScreen(color='#f00', intensity=0.3) {
  const el = document.getElementById('screenFlash');
  el.style.background = color;
  el.style.opacity = intensity;
  setTimeout(() => el.style.opacity = '0', 100);
}

// === 玩家 ===
class Player {
  constructor(charType) {
    const c = CHARS[charType];
    this.charType = charType;
    this.name = c.name; this.icon = c.icon;
    this.x = MAP_W/2; this.y = MAP_H/2;
    this.vx=0; this.vy=0;
    this.maxHp = c.hp; this.hp = c.hp;
    this.speed = c.speed; this.radius = 16;
    this.angle = 0;
    this.meleeRange = c.meleeRange; this.meleeArc = c.meleeArc; this.meleeDmg = c.meleeDmg;
    this.gunDmg = c.gunDmg; this.fireRate = c.fireRate; this.mag = c.mag; this.maxMag = c.mag;
    this.ammo = c.mag; this.reloadTime = c.reload; this.reloading=false; this.reloadEnd=0;
    this.lastShot=0; this.lastMelee=0; this.meleeCooldown=350;
    this.dashTimer=0; this.dashCD=0; this.invuln=0;
    this.color = c.color;
    this.hitFlash = 0;
  }

  update(dt) {
    if (this.hp <= 0) return;
    this.angle = Math.atan2(game.mouse.worldY - this.y, game.mouse.worldX - this.x);

    // 移动
    let mx=0, my=0;
    if (game.keys['w']) my--; if (game.keys['s']) my++;
    if (game.keys['a']) mx--; if (game.keys['d']) mx++;
    const ml = Math.hypot(mx,my);
    if (ml > 0) { mx/=ml; my/=ml; }

    // 冲刺
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.invuln = Math.max(this.invuln, 50);
      this.vx = this.dashDir.x * 9; this.vy = this.dashDir.y * 9;
    } else {
      this.vx = mx * this.speed; this.vy = my * this.speed;
    }
    if (this.dashCD > 0) this.dashCD -= dt;

    this.x += this.vx * (dt/16.67);
    this.y += this.vy * (dt/16.67);
    this.x = clamp(this.x, this.radius, MAP_W - this.radius);
    this.y = clamp(this.y, this.radius, MAP_H - this.radius);

    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // 装弹
    if (this.reloading && game.time >= this.reloadEnd) {
      this.reloading = false;
      this.ammo = this.maxMag;
    }

    // 近战
    if (game.mouse.leftDown && !game.mouse.lastLeft) {
      this.melee();
    }
    game.mouse.lastLeft = game.mouse.leftDown;

    // 射击
    if (game.mouse.rightDown && !this.reloading && this.ammo > 0) {
      if (game.time - this.lastShot >= this.fireRate) {
        this.shoot();
      }
    }
    if (this.ammo === 0 && !this.reloading) this.reload();

    // 必杀
    if (game.keys[' '] && game.rage >= game.maxRage && !game.ultActive) {
      this.ultimate();
    }

    // 必杀持续
    if (game.ultActive) {
      game.ultTimer -= dt;
      // 必杀期间持续范围伤害
      for (const e of game.ent.enemies) {
        if (e.hp <= 0) continue;
        if (dist(this, e) < 200) {
          if (Math.random() < 0.3) {
            e.takeDamage(this.meleeDmg * 0.5, this, true);
            spawnParticles(e.x, e.y, 3, '#ff0', 3, 300);
          }
        }
      }
      if (game.ultTimer <= 0) game.ultActive = false;
    }

    // 连击衰减
    if (game.combo > 0) {
      game.comboTimer -= dt;
      if (game.comboTimer <= 0) {
        game.combo = 0;
        document.getElementById('comboDisplay').style.opacity = '0';
      }
    }
  }

  melee() {
    if (game.time - this.lastMelee < this.meleeCooldown) return;
    this.lastMelee = game.time;
    // 挥砍特效
    game.ent.slashFx.push({
      x:this.x, y:this.y, angle:this.angle, range:this.meleeRange,
      arc:this.meleeArc, life:200, maxLife:200
    });
    shake(3);
    // 范围伤害
    let hitCount = 0;
    for (const e of game.ent.enemies) {
      if (e.hp <= 0) continue;
      const d = dist(this, e);
      if (d > this.meleeRange) continue;
      const a = angleTo(this, e);
      let rel = a - this.angle;
      while (rel > Math.PI) rel -= Math.PI*2;
      while (rel < -Math.PI) rel += Math.PI*2;
      if (Math.abs(rel) > this.meleeArc/2) continue;
      // 连击加成
      const comboMul = 1 + Math.min(game.combo * 0.05, 1.5);
      const dmg = this.meleeDmg * comboMul;
      const knockback = 8 + comboMul * 3;
      e.takeDamage(dmg, this, false);
      e.vx += Math.cos(a) * knockback;
      e.vy += Math.sin(a) * knockback;
      spawnBlood(e.x, e.y, a, knockback);
      hitCount++;
    }
    if (hitCount > 0) {
      addCombo(hitCount);
      game.rage = Math.min(game.maxRage, game.rage + hitCount * 3);
    }
  }

  shoot() {
    this.lastShot = game.time;
    this.ammo--;
    const a = this.angle + rand(-0.04, 0.04);
    game.ent.bullets.push({
      x:this.x + Math.cos(a)*20, y:this.y + Math.sin(a)*20,
      vx:Math.cos(a)*18, vy:Math.sin(a)*18,
      dmg:this.gunDmg, life:1200, traveled:0, range:800, faction:'player'
    });
    spawnParticles(this.x+Math.cos(a)*20, this.y+Math.sin(a)*20, 3, '#ff8', 5, 150);
    shake(1);
  }

  reload() {
    if (this.reloading || this.ammo === this.maxMag) return;
    this.reloading = true;
    this.reloadEnd = game.time + this.reloadTime;
    logMsg('装弹中...', '#888');
  }

  ultimate() {
    game.rage = 0;
    game.ultActive = true;
    game.ultTimer = 1500;
    flashScreen('#ff0', 0.5);
    shake(20);
    logMsg('💥 必杀技释放！', '#ff0');
    // 全屏爆发
    for (const e of game.ent.enemies) {
      if (e.hp <= 0) continue;
      const d = dist(this, e);
      const dmg = this.meleeDmg * 4 * (1 - d/1500);
      if (dmg > 0) {
        e.takeDamage(dmg, this, true);
        const a = angleTo(this, e);
        e.vx += Math.cos(a) * 15;
        e.vy += Math.sin(a) * 15;
        spawnParticles(e.x, e.y, 6, '#ff0', 5, 400);
      }
    }
    // 大范围粒子
    for (let i=0; i<40; i++) {
      const a = (i/40)*Math.PI*2;
      game.ent.particles.push({
        x:this.x, y:this.y, vx:Math.cos(a)*rand(8,15), vy:Math.sin(a)*rand(8,15),
        life:800, maxLife:800, color:'#ff0', size:rand(4,8)
      });
    }
  }

  takeDamage(dmg, fromAngle) {
    if (this.invuln > 0 || this.hp <= 0) return;
    this.hp -= dmg;
    this.invuln = 300;
    this.hitFlash = 200;
    shake(5);
    flashScreen('#f00', 0.15);
    spawnBlood(this.x, this.y, fromAngle + Math.PI, 4);
    // 连击中断
    game.combo = 0;
    document.getElementById('comboDisplay').style.opacity = '0';
    if (this.hp <= 0) {
      this.hp = 0;
      endGame(false);
    }
  }

  draw() {
    const sx = this.x - game.camera.x, sy = this.y - game.camera.y;
    // 必杀光环
    if (game.ultActive) {
      ctx.fillStyle = 'rgba(255,200,0,0.2)';
      ctx.beginPath(); ctx.arc(sx, sy, 60 + Math.sin(game.time*0.02)*10, 0, Math.PI*2); ctx.fill();
    }
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy+8, this.radius, this.radius*0.4, 0, 0, Math.PI*2); ctx.fill();

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);
    // 闪烁
    if (this.hitFlash > 0) ctx.globalAlpha = 0.5 + Math.sin(game.time*0.05)*0.5;
    if (this.invuln > 0 && this.invuln < 280) ctx.globalAlpha *= 0.7;

    // 身体
    const grd = ctx.createRadialGradient(0,0,3, 0,0,this.radius);
    grd.addColorStop(0, this.color);
    grd.addColorStop(1, '#200');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(0,0, this.radius, 0, Math.PI*2); ctx.fill();

    // 武器
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(this.radius-2, 0); ctx.lineTo(this.radius+12, 0); ctx.stroke();

    // 朝向标记
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.radius-4, 0, 3, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // HP条
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx-20, sy-28, 40, 4);
    ctx.fillStyle = this.hp/this.maxHp > 0.3 ? '#4f4' : '#f44';
    ctx.fillRect(sx-20, sy-28, 40 * (this.hp/this.maxHp), 4);
  }
}

// === 敌人 ===
class Enemy {
  constructor(x,y,type='grunt') {
    this.x=x; this.y=y; this.vx=0; this.vy=0;
    this.type = type;
    const stats = {
      grunt:    { hp:60,  speed:1.8, dmg:8,  radius:14, color:'#8a4', score:10, rageGain:2 },
      soldier:  { hp:120, speed:2.0, dmg:15, radius:15, color:'#a44', score:25, rageGain:4 },
      brute:    { hp:300, speed:1.3, dmg:30, radius:20, color:'#a3a', score:60, rageGain:10 },
      elite:    { hp:200, speed:2.5, dmg:20, radius:16, color:'#fa0', score:40, rageGain:7 },
      boss:     { hp:1500,speed:1.5, dmg:45, radius:28, color:'#f0f', score:500, rageGain:30 }
    }[type];
    this.maxHp = stats.hp; this.hp = stats.hp;
    this.speed = stats.speed; this.dmg = stats.dmg;
    this.radius = stats.radius; this.color = stats.color;
    this.score = stats.score; this.rageGain = stats.rageGain;
    this.angle = 0; this.attackCD = 0;
    this.hitFlash = 0; this.knockbackResist = type==='brute'||type==='boss' ? 0.3 : 1.0;
  }

  update(dt) {
    if (this.hp <= 0) return;
    const p = game.ent.player;
    if (!p || p.hp <= 0) return;
    this.angle = angleTo(this, p);
    const d = dist(this, p);

    // 移动
    if (d > this.radius + p.radius + 5) {
      this.vx += Math.cos(this.angle) * this.speed * 0.15;
      this.vy += Math.sin(this.angle) * this.speed * 0.15;
    }
    // 限速
    const sp = Math.hypot(this.vx, this.vy);
    const maxSp = this.speed * (this.hitFlash > 0 ? 0.5 : 1);
    if (sp > maxSp) { this.vx = this.vx/sp*maxSp; this.vy = this.vy/sp*maxSp; }
    this.vx *= 0.92; this.vy *= 0.92;

    this.x += this.vx * (dt/16.67);
    this.y += this.vy * (dt/16.67);
    this.x = clamp(this.x, this.radius, MAP_W - this.radius);
    this.y = clamp(this.y, this.radius, MAP_H - this.radius);

    // 攻击
    if (this.attackCD > 0) this.attackCD -= dt;
    if (d < this.radius + p.radius + 8 && this.attackCD <= 0) {
      p.takeDamage(this.dmg, this.angle);
      this.attackCD = 800;
      // 击退玩家
      this.vx -= Math.cos(this.angle) * 3;
      this.vy -= Math.sin(this.angle) * 3;
    }

    if (this.hitFlash > 0) this.hitFlash -= dt;

    // 避免重叠
    for (const o of game.ent.enemies) {
      if (o === this || o.hp <= 0) continue;
      const dd = dist(this, o);
      const min = this.radius + o.radius;
      if (dd < min && dd > 0) {
        const p2 = (min - dd) / 2;
        const a = angleTo(o, this);
        this.x += Math.cos(a) * p2 * 0.5;
        this.y += Math.sin(a) * p2 * 0.5;
      }
    }
  }

  takeDamage(dmg, from, isUlt=false) {
    if (this.hp <= 0) return;
    this.hp -= dmg;
    this.hitFlash = 150;
    spawnDmgNum(this.x, this.y - this.radius, dmg, isUlt ? '#ff0' : '#fff', isUlt || dmg > 50);
    if (this.hp <= 0) {
      this.die(from);
    }
  }

  die(killer) {
    game.kills++;
    game.score += this.score * (1 + game.combo * 0.1);
    game.rage = Math.min(game.maxRage, game.rage + this.rageGain);
    addCombo(1);
    spawnParticles(this.x, this.y, 15, this.color, 6, 600);
    spawnBlood(this.x, this.y, rand(0,Math.PI*2), 8);
    // 尸体
    game.ent.corpses.push({x:this.x, y:this.y, color:this.color, radius:this.radius, life:5000, angle:this.angle});
    // 掉落
    if (Math.random() < 0.15) {
      game.ent.pickups.push({x:this.x, y:this.y, type:'health', r:10});
    } else if (Math.random() < 0.08) {
      game.ent.pickups.push({x:this.x, y:this.y, type:'rage', r:10});
    }
    shake(this.type === 'boss' ? 15 : 2);
    if (this.type === 'boss') {
      flashScreen('#f0f', 0.4);
      logMsg('💀 BOSS 被击败！', '#f0f');
    }
  }

  draw() {
    if (this.hp <= 0) return;
    const sx = this.x - game.camera.x, sy = this.y - game.camera.y;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy+6, this.radius, this.radius*0.4, 0, 0, Math.PI*2); ctx.fill();

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);
    if (this.hitFlash > 0) { ctx.fillStyle = '#fff'; }
    else {
      const grd = ctx.createRadialGradient(0,0,2, 0,0,this.radius);
      grd.addColorStop(0, this.color); grd.addColorStop(1, '#111');
      ctx.fillStyle = grd;
    }
    ctx.beginPath(); ctx.arc(0,0, this.radius, 0, Math.PI*2); ctx.fill();
    // 眼睛/朝向
    ctx.fillStyle = '#f00';
    ctx.beginPath(); ctx.arc(this.radius-5, -3, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(this.radius-5, 3, 2, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // HP条
    if (this.hp < this.maxHp) {
      const bw = this.radius * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx-bw/2, sy-this.radius-8, bw, 3);
      ctx.fillStyle = this.type === 'boss' ? '#f0f' : '#f44';
      ctx.fillRect(sx-bw/2, sy-this.radius-8, bw * (this.hp/this.maxHp), 3);
    }
  }
}

// === 子弹 ===
function updateBullets(dt) {
  for (let i=game.ent.bullets.length-1; i>=0; i--) {
    const b = game.ent.bullets[i];
    b.x += b.vx * (dt/16.67);
    b.y += b.vy * (dt/16.67);
    b.life -= dt;
    b.traveled += Math.hypot(b.vx, b.vy);
    if (b.life <= 0 || b.traveled > b.range || b.x<0||b.x>MAP_W||b.y<0||b.y>MAP_H) {
      game.ent.bullets.splice(i,1); continue;
    }
    for (const e of game.ent.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(b.x-e.x, b.y-e.y) < e.radius) {
        e.takeDamage(b.dmg, null);
        const a = Math.atan2(b.vy, b.vx);
        e.vx += Math.cos(a) * 5 * e.knockbackResist;
        e.vy += Math.sin(a) * 5 * e.knockbackResist;
        spawnBlood(e.x, e.y, a, 5);
        game.ent.bullets.splice(i,1);
        break;
      }
    }
  }
}

// === 挥砍特效 ===
function updateSlashFx(dt) {
  for (let i=game.ent.slashFx.length-1; i>=0; i--) {
    const s = game.ent.slashFx[i];
    s.life -= dt;
    if (s.life <= 0) game.ent.slashFx.splice(i,1);
  }
}

// === 粒子 ===
function updateParticles(dt) {
  for (let i=game.ent.particles.length-1; i>=0; i--) {
    const p = game.ent.particles[i];
    p.x += p.vx * (dt/16.67);
    p.y += p.vy * (dt/16.67);
    p.vx *= 0.93; p.vy *= 0.93;
    p.life -= dt;
    if (p.life <= 0) game.ent.particles.splice(i,1);
  }
}

// === 伤害数字 ===
function updateDmgNums(dt) {
  for (let i=game.ent.dmgNums.length-1; i>=0; i--) {
    const d = game.ent.dmgNums[i];
    d.y += d.vy * (dt/16.67);
    d.vy += 0.05;
    d.life -= dt;
    if (d.life <= 0) game.ent.dmgNums.splice(i,1);
  }
}

// === 拾取物 ===
function updatePickups(dt) {
  const p = game.ent.player;
  if (!p || p.hp <= 0) return;
  for (let i=game.ent.pickups.length-1; i>=0; i--) {
    const it = game.ent.pickups[i];
    if (dist(p, it) < p.radius + it.r) {
      if (it.type === 'health') {
        p.hp = Math.min(p.maxHp, p.hp + 50);
        logMsg('+50 HP', '#4f4');
        spawnParticles(p.x, p.y, 8, '#4f4', 3, 400);
      } else if (it.type === 'rage') {
        game.rage = Math.min(game.maxRage, game.rage + 25);
        logMsg('+25 怒气', '#fa0');
        spawnParticles(p.x, p.y, 8, '#fa0', 3, 400);
      }
      game.ent.pickups.splice(i,1);
    }
  }
}

// === 尸体 ===
function updateCorpses(dt) {
  for (let i=game.ent.corpses.length-1; i>=0; i--) {
    const c = game.ent.corpses[i];
    c.life -= dt;
    if (c.life <= 0) game.ent.corpses.splice(i,1);
  }
}

// === 连击 ===
function addCombo(n) {
  game.combo += n;
  game.comboTimer = 4000;
  if (game.combo > game.maxCombo) game.maxCombo = game.combo;
  if (game.combo >= 3) {
    const cd = document.getElementById('comboDisplay');
    cd.style.opacity = '1';
    document.getElementById('comboNum').textContent = game.combo;
  }
}

// === 波次系统 ===
function startWave() {
  const w = game.wave;
  game.enemiesInWave = 8 + Math.floor(w * 3);
  game.enemiesSpawned = 0;
  game.spawnQueue = [];
  for (let i=0; i<game.enemiesInWave; i++) {
    let type = 'grunt';
    const r = Math.random();
    if (w >= 3 && r < 0.15) type = 'soldier';
    if (w >= 5 && r < 0.08) type = 'elite';
    if (w >= 4 && i === game.enemiesInWave-1 && w % 5 === 0) type = 'brute';
    if (w % 10 === 0 && i === game.enemiesInWave-1) type = 'boss';
    game.spawnQueue.push(type);
  }
  game.spawnTimer = 500;
  logMsg(`⚔ 第 ${w} 波 - ${game.enemiesInWave} 个敌人来袭！`, '#f88');
  if (w % 10 === 0) logMsg('⚠ BOSS 出现！', '#f0f');
}

function spawnEnemy(type) {
  // 从屏幕外刷新
  const p = game.ent.player;
  const angle = rand(0, Math.PI*2);
  const d = 500 + rand(0, 200);
  const x = clamp(p.x + Math.cos(angle)*d, 50, MAP_W-50);
  const y = clamp(p.y + Math.sin(angle)*d, 50, MAP_H-50);
  game.ent.enemies.push(new Enemy(x, y, type));
  game.enemiesSpawned++;
}

function updateWave(dt) {
  // 刷新敌人
  if (game.spawnQueue.length > 0) {
    game.spawnTimer -= dt;
    if (game.spawnTimer <= 0) {
      spawnEnemy(game.spawnQueue.shift());
      game.spawnTimer = rand(300, 800);
    }
  }
  // 检查波次结束
  const alive = game.ent.enemies.filter(e => e.hp > 0).length;
  if (game.enemiesSpawned >= game.enemiesInWave && alive === 0 && game.spawnQueue.length === 0) {
    game.wave++;
    game.waveTimer = 3000;
    logMsg(`✅ 第 ${game.wave-1} 波清除！准备下一波...`, '#4f4');
    // 恢复一些
    const p = game.ent.player;
    p.hp = Math.min(p.maxHp, p.hp + 30);
    game.rage = Math.min(game.maxRage, game.rage + 15);
  }
  // 波次间隔
  if (game.waveTimer > 0) {
    game.waveTimer -= dt;
    if (game.waveTimer <= 0) startWave();
  }
}

// === 渲染 ===
function render() {
  // 相机跟随 + 震动
  const p = game.ent.player;
  if (p) {
    game.camera.x = p.x - VIEW_W/2;
    game.camera.y = p.y - VIEW_H/2;
    if (game.camera.shake > 0) {
      game.camera.x += rand(-game.camera.shake, game.camera.shake);
      game.camera.y += rand(-game.camera.shake, game.camera.shake);
      game.camera.shake *= 0.85;
      if (game.camera.shake < 0.5) game.camera.shake = 0;
    }
    game.camera.x = clamp(game.camera.x, 0, MAP_W - VIEW_W);
    game.camera.y = clamp(game.camera.y, 0, MAP_H - VIEW_H);
  }

  // 背景
  ctx.fillStyle = '#0a0505';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // 地面纹理
  ctx.strokeStyle = 'rgba(40,20,10,0.3)'; ctx.lineWidth = 1;
  const gridSize = 80;
  const offX = -game.camera.x % gridSize;
  const offY = -game.camera.y % gridSize;
  for (let x=offX; x<VIEW_W; x+=gridSize) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,VIEW_H); ctx.stroke(); }
  for (let y=offY; y<VIEW_H; y+=gridSize) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(VIEW_W,y); ctx.stroke(); }
  // 地图边界
  ctx.strokeStyle = '#400'; ctx.lineWidth = 4;
  ctx.strokeRect(-game.camera.x, -game.camera.y, MAP_W, MAP_H);

  // 尸体
  for (const c of game.ent.corpses) {
    const sx = c.x - game.camera.x, sy = c.y - game.camera.y;
    ctx.globalAlpha = Math.min(1, c.life/1000) * 0.4;
    ctx.fillStyle = c.color;
    ctx.beginPath(); ctx.arc(sx, sy, c.radius, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 拾取物
  for (const it of game.ent.pickups) {
    const sx = it.x - game.camera.x, sy = it.y - game.camera.y;
    const bob = Math.sin(game.time*0.005 + it.x) * 3;
    const colors = { health:'#4f4', rage:'#fa0' };
    const icons = { health:'❤', rage:'⚡' };
    ctx.fillStyle = colors[it.type];
    ctx.beginPath(); ctx.arc(sx, sy+bob, it.r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(icons[it.type], sx, sy+bob+4);
  }

  // 敌人
  for (const e of game.ent.enemies) e.draw();

  // 玩家
  if (p) p.draw();

  // 挥砍特效
  for (const s of game.ent.slashFx) {
    const sx = s.x - game.camera.x, sy = s.y - game.camera.y;
    const t = s.life / s.maxLife;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(s.angle);
    ctx.globalAlpha = t * 0.8;
    const grd = ctx.createRadialGradient(0,0,s.range*0.3, 0,0,s.range);
    grd.addColorStop(0, 'rgba(255,200,100,0)');
    grd.addColorStop(0.7, `rgba(255,180,50,${t*0.6})`);
    grd.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0, 0, s.range, -s.arc/2, s.arc/2);
    ctx.closePath();
    ctx.fill();
    // 边缘线
    ctx.strokeStyle = `rgba(255,220,100,${t})`; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, s.range, -s.arc/2, s.arc/2);
    ctx.stroke();
    ctx.restore();
  }

  // 子弹
  for (const b of game.ent.bullets) {
    const sx = b.x - game.camera.x, sy = b.y - game.camera.y;
    ctx.strokeStyle = '#ff4'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - b.vx*2, sy - b.vy*2);
    ctx.stroke();
  }

  // 粒子
  for (const p of game.ent.particles) {
    const sx = p.x - game.camera.x, sy = p.y - game.camera.y;
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 伤害数字
  for (const d of game.ent.dmgNums) {
    const sx = d.x - game.camera.x, sy = d.y - game.camera.y;
    ctx.globalAlpha = d.life / d.maxLife;
    ctx.font = `bold ${d.size}px sans-serif`;
    ctx.fillStyle = d.color;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.textAlign = 'center';
    ctx.strokeText(d.dmg, sx, sy);
    ctx.fillText(d.dmg, sx, sy);
    if (d.crit) {
      ctx.font = '10px sans-serif';
      ctx.fillText('CRIT!', sx, sy+14);
    }
  }
  ctx.globalAlpha = 1;

  // 必杀技倒计时
  if (game.ultActive) {
    ctx.fillStyle = 'rgba(255,200,0,0.1)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ff0'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText('⚡ 必杀技释放中 ⚡', VIEW_W/2, 60);
    ctx.fillText('⚡ 必杀技释放中 ⚡', VIEW_W/2, 60);
  }

  // 波次间隔
  if (game.waveTimer > 0 && game.waveTimer < 3000) {
    ctx.font = '32px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#fc4'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    const txt = `第 ${game.wave} 波 - ${3 - Math.ceil(game.waveTimer/1000)}秒后开始`;
    ctx.strokeText(txt, VIEW_W/2, VIEW_H/2);
    ctx.fillText(txt, VIEW_W/2, VIEW_H/2);
  }
}

// === HUD更新 ===
function updateHUD() {
  const p = game.ent.player;
  if (!p) return;
  document.getElementById('hpFill').style.width = (p.hp/p.maxHp*100) + '%';
  const rf = document.getElementById('rageFill');
  rf.style.width = (game.rage/game.maxRage*100) + '%';
  rf.classList.toggle('full', game.rage >= game.maxRage);
  document.getElementById('ultPrompt').style.display = (game.rage >= game.maxRage && !game.ultActive) ? 'block' : 'none';
  document.getElementById('scoreText').textContent = Math.floor(game.score);
  document.getElementById('waveText').textContent = `第 ${game.wave} 波`;
  document.getElementById('killText').textContent = `击杀: ${game.kills}`;
  // 连击计时条
  if (game.combo > 0) {
    document.getElementById('comboTimerFill').style.width = (game.comboTimer/4000*100) + '%';
  }
}

// === 游戏循环 ===
let lastT = 0;
function loop(t) {
  const dt = Math.min(50, t - lastT);
  lastT = t;
  game.time = t;

  if (game.running && !game.over) {
    if (game.ent.player) game.ent.player.update(dt);
    for (const e of game.ent.enemies) e.update(dt);
    updateBullets(dt);
    updateSlashFx(dt);
    updateParticles(dt);
    updateDmgNums(dt);
    updatePickups(dt);
    updateCorpses(dt);
    updateWave(dt);
    // 清理死敌
    game.ent.enemies = game.ent.enemies.filter(e => e.hp > 0);
    updateHUD();
  }
  render();
  requestAnimationFrame(loop);
}

// === 游戏结束 ===
function endGame(won) {
  game.over = true;
  game.running = false;
  document.getElementById('gameOverTitle').textContent = won ? '🏆 胜利！' : '💀 战败';
  document.getElementById('finalStats').innerHTML = `
    分数: <b>${Math.floor(game.score)}</b><br>
    击杀: <b>${game.kills}</b><br>
    最高连击: <b>${game.maxCombo}</b><br>
    到达波次: <b>第 ${game.wave} 波</b>
  `;
  document.getElementById('gameOverScreen').style.display = 'flex';
}

// === 初始化 ===
function startGame() {
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'none';
  // 重置
  game.running = true; game.over = false;
  game.time = 0; game.score = 0; game.kills = 0; game.wave = 1;
  game.combo = 0; game.comboTimer = 0; game.maxCombo = 0;
  game.rage = 0; game.ultActive = false;
  game.ent.enemies = []; game.ent.bullets = []; game.ent.particles = [];
  game.ent.slashFx = []; game.ent.dmgNums = []; game.ent.pickups = []; game.ent.corpses = [];
  game.ent.player = new Player(game.selectedChar);
  startWave();
  logMsg(`⚔ ${CHARS[game.selectedChar].name} 出击！`, '#fc4');
  logMsg('左键挥砍 · 右键射击 · 空格必杀', '#888');
}

// === 输入 ===
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  game.keys[k] = true;
  if (k === ' ' && game.running) e.preventDefault();
  if (k === 'shift' && game.running) {
    const p = game.ent.player;
    if (p && p.dashCD <= 0 && p.hp > 0) {
      let mx=0,my=0;
      if (game.keys['w']) my--; if (game.keys['s']) my++;
      if (game.keys['a']) mx--; if (game.keys['d']) mx++;
      if (mx===0 && my===0) { mx = Math.cos(p.angle); my = Math.sin(p.angle); }
      const ml = Math.hypot(mx,my); mx/=ml; my/=ml;
      p.dashDir = {x:mx, y:my};
      p.dashTimer = 200; p.dashCD = 1500;
      spawnParticles(p.x, p.y, 8, '#4af', 4, 300);
    }
  }
  if (k === 'r' && game.running) {
    const p = game.ent.player;
    if (p) p.reload();
  }
});
window.addEventListener('keyup', e => { game.keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  game.mouse.x = e.clientX - rect.left;
  game.mouse.y = e.clientY - rect.top;
  game.mouse.worldX = game.mouse.x + game.camera.x;
  game.mouse.worldY = game.mouse.y + game.camera.y;
});
canvas.addEventListener('mousedown', e => {
  if (e.button === 0) game.mouse.leftDown = true;
  if (e.button === 2) game.mouse.rightDown = true;
});
canvas.addEventListener('mouseup', e => {
  if (e.button === 0) game.mouse.leftDown = false;
  if (e.button === 2) game.mouse.rightDown = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// 角色选择
document.querySelectorAll('.char-card').forEach(c => {
  c.onclick = () => {
    document.querySelectorAll('.char-card').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected');
    game.selectedChar = c.dataset.char;
  };
});
document.getElementById('startBtn').onclick = startGame;
document.getElementById('restartBtn').onclick = startGame;

requestAnimationFrame(loop);
