// ============================================================
// 城市混战 2.0 - 核心游戏逻辑
// 身体部位伤害 | 流血系统 | 急救站 | 互动装置 | 队友救援
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimap');
const mctx = miniCanvas.getContext('2d');
const VIEW_W = canvas.width, VIEW_H = canvas.height;

// === 工具函数 ===
const rand = (a,b) => a + Math.random()*(b-a);
const randi = (a,b) => Math.floor(rand(a,b));
const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const lerp = (a,b,t) => a+(b-a)*t;
const angleTo = (a,b) => Math.atan2(b.y-a.y, b.x-a.x);

// === 武器定义 (大幅降低伤害，更耐打) ===
const WEAPONS = {
  pistol:  { name:'手枪',    icon:'🔫', dmg:7,  fireRate:350, mag:12, reload:1100, speed:14, spread:0.06, bullets:1, auto:false, pen:0, range:550, color:'#fc6',
             stats:{dmg:2,rate:2,mag:2,range:2} },
  rifle:   { name:'步枪',    icon:'🎖',  dmg:9,  fireRate:140, mag:30, reload:2000, speed:17, spread:0.08, bullets:1, auto:true,  pen:1, range:850, color:'#f88',
             stats:{dmg:3,rate:3,mag:4,range:3} },
  shotgun: { name:'霰弹枪',  icon:'💥', dmg:5,  fireRate:800, mag:6,  reload:2500, speed:12, spread:0.24, bullets:7, auto:false, pen:0, range:320, color:'#fa4',
             stats:{dmg:3,rate:1,mag:2,range:1} },
  sniper:  { name:'狙击枪',  icon:'🎯', dmg:40, fireRate:1500,mag:5,  reload:2800, speed:24, spread:0.005,bullets:1, auto:false, pen:3, range:1500, color:'#4af',
             stats:{dmg:5,rate:1,mag:2,range:5} },
  smg:     { name:'冲锋枪',  icon:'⚡', dmg:5,  fireRate:90,  mag:40, reload:1800, speed:15, spread:0.12, bullets:1, auto:true,  pen:0, range:480, color:'#8f8',
             stats:{dmg:2,rate:5,mag:5,range:2} }
};
const WEAPON_KEYS = ['pistol','rifle','shotgun','sniper','smg'];

// === 身体部位系统 ===
const BODY_PARTS = {
  head:     { name:'头部',  dmgMul:2.0, bleed:4, label:'爆头!' },
  heart:    { name:'心脏',  dmgMul:1.8, bleed:4, label:'射中心脏!' },
  torso:    { name:'躯干',  dmgMul:1.0, bleed:2, label:'' },
  leftArm:  { name:'左臂',  dmgMul:0.6, bleed:1, label:'伤臂!无法射击' },
  rightArm: { name:'右臂',  dmgMul:0.6, bleed:1, label:'伤臂!无法射击' },
  leftLeg:  { name:'左腿',  dmgMul:0.6, bleed:1, label:'伤腿!移动减速' },
  rightLeg: { name:'右腿',  dmgMul:0.6, bleed:1, label:'伤腿!移动减速' }
};

function getBodyPart(bullet, entity) {
  const impactAngle = Math.atan2(bullet.y - entity.y, bullet.x - entity.x);
  let rel = impactAngle - entity.angle;
  while (rel > Math.PI) rel -= Math.PI*2;
  while (rel < -Math.PI) rel += Math.PI*2;
  const a = Math.abs(rel);
  if (a < 0.4) return Math.random() < 0.35 ? 'head' : 'heart';
  if (a < 1.1) return rel > 0 ? 'rightArm' : 'leftArm';
  if (a > 2.1) return Math.random() < 0.5 ? 'leftLeg' : 'rightLeg';
  return 'torso';
}

// === 地图定义 ===
const MAPS = {
  city: {
    name:'城市街道', icon:'🏙', desc:'建筑密集·车辆掩体多',
    info:'4000×2800 | 中等', w:4000, h:2800,
    enemySpawns:[[3800,200],[3700,400],[3900,300],[3600,600],[3850,500]],
    gangSpawns:[[3500,2400],[3700,2500],[3400,2600],[3650,2350]],
    playerSpawn:[200,1400]
  },
  warehouse: {
    name:'废弃仓库', icon:'🏭', desc:'货箱遍布·室内近战',
    info:'3600×2400 | 困难', w:3600, h:2400,
    enemySpawns:[[3400,200],[3300,400],[3500,300],[3200,600],[3350,500]],
    gangSpawns:[[3200,2000],[3400,2100],[3100,2200],[3350,1950]],
    playerSpawn:[200,1200]
  },
  industrial: {
    name:'工业港区', icon:'⚓', desc:'集装箱迷宫·开阔地多',
    info:'4400×3000 | 专家', w:4400, h:3000,
    enemySpawns:[[4200,200],[4100,400],[4300,300],[4000,600],[4150,500]],
    gangSpawns:[[3900,2600],[4100,2700],[3800,2800],[4050,2550]],
    playerSpawn:[200,1500]
  }
};

// === 阵营 ===
const F_BLUE='blue', F_RED='red', F_GREEN='green';
const isEnemy = (f1,f2) => f1 !== f2;

// === 游戏状态 ===
const game = {
  running:false, over:false, time:0, kills:0, money:0,
  selectedMap:'city', selectedWeapon:'rifle', selectedMode:'infinite',
  extraction:{active:false,x:0,y:0,entryTimer:0,killGoal:40},
  camera:{x:0,y:0},
  keys:{}, mouse:{x:0,y:0,down:false,worldX:0,worldY:0,lastDown:false},
  ent:{
    players:[], enemies:[], gangsters:[], teammates:[],
    bullets:[], covers:[], pickups:[], particles:[],
    smokes:[], grenades:[], bloodstains:[],
    hitMarkers:[], dmgIndicators:[],
    devices:[], barrels:[]
  }
};

// 游戏模式定义
const MODES = {
  infinite:  { name:'无限模式', icon:'♾️', desc:'无限敌人波次·增援不断', info:'杀完所有敌人胜利'},
  extraction:{ name:'撤离模式', icon:'🚁', desc:'击杀目标后撤离点开启', info:'击杀达标→撤离点→撤离胜利'}
};

// === 消息日志 ===
function logMsg(txt, color='#8cf') {
  const log = document.getElementById('msgLog');
  const d = document.createElement('div');
  d.className = 'log-msg'; d.style.borderLeftColor = color;
  d.textContent = txt; log.insertBefore(d, log.firstChild);
  while (log.childNodes.length > 6) log.removeChild(log.lastChild);
}

// === 粒子 ===
function spawnParticles(x,y,count,color,speed=3,life=400) {
  // 粒子上限：超过500丢最旧的
  if (game.ent.particles.length > 500) game.ent.particles.splice(0, game.ent.particles.length - 450);
  for (let i=0;i<count;i++) {
    const a = (i/count)*Math.PI*2 + rand(-0.3,0.3);
    game.ent.particles.push({
      x,y, vx:Math.cos(a)*rand(speed*0.3,speed), vy:Math.sin(a)*rand(speed*0.3,speed),
      life, maxLife:life, color, size:rand(2,4)
    });
  }
}
function spawnMuzzleFlash(x,y,angle,color='#ff8') {
  for (let i=0;i<4;i++) {
    const a = angle + rand(-0.2,0.2);
    game.ent.particles.push({
      x:x+Math.cos(angle)*16, y:y+Math.sin(angle)*16,
      vx:Math.cos(a)*rand(4,8), vy:Math.sin(a)*rand(4,8),
      life:100, maxLife:100, color, size:rand(3,6)
    });
  }
}
function spawnBloodstain(x,y,amt=1) {
  for (let i=0;i<amt;i++)
    game.ent.bloodstains.push({x:x+rand(-10,10), y:y+rand(-10,10), r:rand(6,14), color:`rgba(140,20,20,${rand(0.4,0.7)})`});
  if (game.ent.bloodstains.length > 150) game.ent.bloodstains.splice(0, 20);
}

// === 浮动文字 ===
function spawnHitMarker(x,y,text,color) {
  game.ent.hitMarkers.push({x,y,text,color,vy:-1.5,life:1200,maxLife:1200});
}

// === 伤害方向指示 ===
function spawnDmgIndicator(angle) {
  game.ent.dmgIndicators.push({angle,life:1500,maxLife:1500});
}

// === 视线检测 (核心修复) ===
function lineOfSight(x1,y1,x2,y2) {
  const dx=x2-x1, dy=y2-y1;
  const d=Math.hypot(dx,dy);
  if (d < 1) return true;
  const steps = Math.ceil(d / 10);
  for (let i=1; i<steps; i++) {
    const t = i/steps;
    const x = x1+dx*t, y = y1+dy*t;
    for (const c of game.ent.covers) {
      if (!c.sightBlock) continue;
      if (x > c.x && x < c.x+c.w && y > c.y && y < c.y+c.h) return false;
    }
  }
  // 烟雾遮挡
  for (const s of game.ent.smokes) {
    if (s.fuse > 0) continue;
    const fx=x1-s.x, fy=y1-s.y;
    const a=dx*dx+dy*dy, b=2*(fx*dx+fy*dy), cc=fx*fx+fy*fy-s.radius*s.radius;
    let disc=b*b-4*a*cc;
    if (disc >= 0) {
      disc=Math.sqrt(disc);
      const t1=(-b-disc)/(2*a), t2=(-b+disc)/(2*a);
      if ((t1>=0&&t1<=1)||(t2>=0&&t2<=1)||(t1<0&&t2>1)) return false;
    }
  }
  return true;
}

// === 找掩体 ===
function findCover(from, target) {
  let best=null, bestScore=-Infinity;
  for (const c of game.ent.covers) {
    if (!c.providesCover) continue;
    const cx=c.x+c.w/2, cy=c.y+c.h/2;
    const awayA = Math.atan2(cy-target.y, cx-target.x);
    for (let s=0; s<6; s++) {
      const a = awayA + (s-3)*0.25;
      const dd = Math.max(c.w,c.h)/2 + 24;
      const px=cx+Math.cos(a)*dd, py=cy+Math.sin(a)*dd;
      if (px<30||px>game.mapW-30||py<30||py>game.mapH-30) continue;
      let score = -dist(from,{x:px,y:py})*0.4;
      if (lineOfSight(px,py,target.x,target.y)) score -= 100;
      else score += 200;
      if (score > bestScore) { bestScore=score; best={x:px,y:py}; }
    }
  }
  return best;
}

// === Entity 基类 ===
class Entity {
  constructor(x,y,faction) {
    this.x=x; this.y=y; this.vx=0; this.vy=0;
    this.faction=faction;
    this.hp=100; this.maxHp=100;
    this.armor=0; this.maxArmor=100;
    this.angle=0; this.radius=13; this.speed=2.2;
    this.weapon={type:'pistol',ammo:12,reloading:false,reloadEnd:0,lastShot:0};
    this.ownedWeapons={pistol:true,rifle:false,shotgun:false,sniper:false,smg:false};
    this.ammoReserve={pistol:48,rifle:0,shotgun:0,sniper:0,smg:0};
    this.isPlayer=false; this.invuln=0;
    this.stamina=100; this.sprinting=false;
    this.rolling=0; this.rollDir={x:0,y:0}; this.rollBoost=0;
    this.downed=false; this.downTimer=0;
    this.items={medkit:2,bandage:2,armor:1,energy:1,smoke:2};
    this.energyBoost=0;
    this.aiState='idle'; this.aiTarget=null;
    this.aiCoverPos=null; this.aiMoveTimer=0;
    this.aiGrenadeTimer=rand(4000,9000);
    this.aiFlankSide=Math.random()<0.5?1:-1;
    this.aiRetreating=false; this.aiSuppressing=false;
    this.aiSuppressTimer=0; this.aiFlankTimer=0;
    this.aiReviveTimer=0;
    this.lastSeen={}; this.nameTag='';
    // 身体部位 + 流血
    this.bodyParts={head:100,heart:100,torso:100,leftArm:100,rightArm:100,leftLeg:100,rightLeg:100};
    this.wounds=[];
    this.legSlowdown=0; this.armDisabled=0;
    this.lastDamageTime=0;
    this.lastRegenTime=0;
    this.mounted=null;
    this.bleedTimer=0;
    // 闪避充能系统
    this.dodgeCharges=0; this.maxDodgeCharges=3;
  }

  takeDamage(dmg, bullet, fromAngle) {
    if (this.invuln > 0 || this.hp <= 0) return;
    // 队友被动闪避：有概率自动躲避子弹
    if (!this.isPlayer && this.dodgeChance > 0 && bullet && this.dodgeCD <= 0) {
      if (Math.random() < this.dodgeChance) {
        this.invuln = 300;
        this.dodgeCD = 600;
        // 翻滚方向：垂直于子弹方向
        const perpA = bullet.angle + Math.PI/2 * (Math.random()<0.5?1:-1);
        this.vx = Math.cos(perpA) * 4; this.vy = Math.sin(perpA) * 4;
        spawnParticles(this.x, this.y, 6, '#4cf', 3, 300);
        return;
      }
    }
    // 闪避充能：有充能时自动消耗免疫子弹伤害
    if (this.isPlayer && this.dodgeCharges > 0 && bullet) {
      this.dodgeCharges--;
      this.invuln = 200;
      logMsg('💨 闪避成功！', '#4cf');
      spawnHitMarker(this.x, this.y-20, '闪避!', '#4cf');
      spawnParticles(this.x, this.y, 10, '#4cf', 4, 400);
      return;
    }
    // 判定身体部位
    const part = getBodyPart(bullet, this);
    const bp = BODY_PARTS[part];
    let finalDmg = dmg * bp.dmgMul;
    // 护甲：90%由护甲承担，10%直接扣HP，护甲消耗更慢（只扣0.5倍伤害）
    let d = finalDmg;
    if (this.armor > 0) {
      const absorbedByArmor = d * 0.9;       // 护甲承担90%
      this.armor = Math.max(0, this.armor - absorbedByArmor * 0.5);  // 护甲耐用：只消耗一半
      d = d * 0.1;                          // HP承担10%
    }
    this.hp -= d;
    this.invuln = 120;
    this.lastDamageTime = game.time;
    // 身体部位损伤
    this.bodyParts[part] = Math.max(0, this.bodyParts[part] - finalDmg);
    // 流血
    this.wounds.push({part, rate:bp.bleed, timer:10000});
    // 特殊效果
    if (part === 'leftLeg' || part === 'rightLeg') {
      this.legSlowdown = Math.min(0.7, this.legSlowdown + 0.3);
    }
    if (part === 'leftArm' || part === 'rightArm') {
      this.armDisabled = Math.max(this.armDisabled, 3000);
    }
    // 浮动文字
    if (bp.label) {
      spawnHitMarker(this.x, this.y - 20, bp.label,
        part==='head'||part==='heart' ? '#f44' : '#fc4');
    }
    // 伤害方向
    if (this.isPlayer && bullet) {
      spawnDmgIndicator(Math.atan2(bullet.y - this.y, bullet.x - this.x));
      flashDamage();
    }
    // 粒子
    spawnParticles(this.x, this.y, 6, '#c22', 2.5, 300);
    spawnBloodstain(this.x, this.y, 1);
    // 倒地判定
    if (this.hp <= 20 && this.hp > 0 && !this.downed) {
      if (Math.random() < 0.3) {
        this.downed = true; this.downTimer = 45000; this.hp = 1;
        if (this.isPlayer) showDownedOverlay();
      }
    }
  }

  updateBleeding(dt) {
    // 流血
    let totalBleed = 0;
    for (let i = this.wounds.length-1; i >= 0; i--) {
      const w = this.wounds[i];
      w.timer -= dt;
      if (w.timer <= 0) { this.wounds.splice(i,1); continue; }
      totalBleed += w.rate;
    }
    if (totalBleed > 0) {
      this.hp -= totalBleed * (dt / 1000);
      this.bleedTimer += dt;
      if (this.bleedTimer > 400) {
        this.bleedTimer = 0;
        spawnParticles(this.x + rand(-6,6), this.y + rand(-6,6), 1, '#a22', 0.5, 300);
      }
    }
    // 自然回血 (5秒未受伤 + 无流血)
    if (this.wounds.length === 0 && game.time - this.lastDamageTime > 5000 && this.hp > 0 && this.hp < this.maxHp) {
      if (game.time - this.lastRegenTime > 3000) {
        this.lastRegenTime = game.time;
        this.hp = Math.min(this.maxHp, this.hp + 1);
      }
    }
    // 状态恢复
    if (this.legSlowdown > 0) this.legSlowdown = Math.max(0, this.legSlowdown - dt * 0.0001);
    if (this.armDisabled > 0) this.armDisabled -= dt;
  }

  bandage() {
    if (this.wounds.length === 0) return false;
    this.wounds = [];
    this.legSlowdown *= 0.5;
    this.armDisabled = 0;
    spawnParticles(this.x, this.y, 10, '#fff', 2, 500);
    return true;
  }

  heal(amt) { this.hp = Math.min(this.maxHp, this.hp + amt); }
  giveArmor(amt) { this.armor = Math.min(this.maxArmor, this.armor + amt); }
  // 完全治愈：清除伤口、肢体损伤、身体部位
  fullyHeal() {
    this.wounds = [];
    this.legSlowdown = 0;
    this.armDisabled = 0;
    this.bodyParts = {head:100,torso:100,leftArm:100,rightArm:100,leftLeg:100,rightLeg:100,heart:100};
  }

  useItem(type) {
    if (!this.items[type] || this.items[type] <= 0) return false;
    switch(type) {
      case 'medkit':
        if (this.hp >= this.maxHp && !this.downed) return false;
        this.heal(60);
        if (this.downed) { this.downed=false; this.hp=50; if(this.isPlayer) hideDownedOverlay(); }
        this.fullyHeal();
        this.items.medkit--;
        spawnParticles(this.x,this.y,12,'#4f8',2,500);
        return true;
      case 'bandage':
        if (this.wounds.length === 0) return false;
        this.bandage();
        this.items.bandage--;
        return true;
      case 'armor':
        if (this.armor >= this.maxArmor) return false;
        this.giveArmor(80); this.items.armor--;
        spawnParticles(this.x,this.y,10,'#48f',2,500);
        return true;
      case 'energy':
        this.energyBoost = 10000; this.heal(15); this.fullyHeal(); this.items.energy--;
        spawnParticles(this.x,this.y,12,'#ff4',2.5,600);
        return true;
      case 'smoke': {
        const sa = this.angle;
        // 投掷更远（100像素），散开更大
        game.ent.smokes.push({x:this.x, y:this.y,
          vx:Math.cos(sa)*7, vy:Math.sin(sa)*7, fuse:350, travelDist:120, traveled:0,
          life:14000, maxLife:14000, radius:180});
        this.items.smoke--;
        spawnParticles(this.x+Math.cos(sa)*20, this.y+Math.sin(sa)*20, 8, '#ccc', 2, 400);
        return true;
      }
    }
    return false;
  }

  switchWeapon(type) {
    if (!this.ownedWeapons[type] || this.weapon.reloading) return false;
    this.weapon.type = type;
    this.weapon.ammo = WEAPONS[type].mag;
    this.weapon.lastShot = 0;
    return true;
  }

  reload() {
    if (this.weapon.reloading) return;
    const w = WEAPONS[this.weapon.type];
    if (this.weapon.ammo >= w.mag || this.ammoReserve[this.weapon.type] <= 0) return;
    this.weapon.reloading = true;
    this.weapon.reloadEnd = game.time + w.reload;
    if (this.isPlayer) logMsg(`装弹中... ${w.name}`, '#fc6');
  }

  canShoot() {
    if (this.weapon.reloading || this.weapon.ammo <= 0) return false;
    if (this.armDisabled > 0) return false;
    if (this.downed) return false;
    const w = WEAPONS[this.weapon.type];
    return game.time - this.weapon.lastShot >= w.fireRate;
  }

  shootAt(tx, ty, dmgMul=1) {
    if (!this.canShoot()) return false;
    const w = WEAPONS[this.weapon.type];
    this.weapon.ammo--;
    this.weapon.lastShot = game.time;
    const baseAngle = Math.atan2(ty - this.y, tx - this.x);
    // 固定机枪：伤害×2.5，穿透×2，完全无散布
    const turretMul = this.mounted && this.mounted.type === 'turret' ? 2.5 : 1.0;
    const spreadMul = this.mounted && this.mounted.type === 'turret' ? 0 : 1.0;
    const penMul = this.mounted && this.mounted.type === 'turret' ? 2 : 1;
    for (let i=0; i<w.bullets; i++) {
      const spread = (Math.random()-0.5) * w.spread * 2 * spreadMul;
      const a = baseAngle + spread;
      game.ent.bullets.push({
        x:this.x+Math.cos(a)*16, y:this.y+Math.sin(a)*16,
        vx:Math.cos(a)*w.speed, vy:Math.sin(a)*w.speed,
        dmg:w.dmg * turretMul * dmgMul, faction:this.faction, life:2000, pen:w.pen * penMul,
        color:this.mounted && this.mounted.type==='turret' ? '#ff0' : w.color,
        hit:new Set(), range:w.range, traveled:0,
        angle:a
      });
    }
    spawnMuzzleFlash(this.x, this.y, baseAngle, w.color);
    return true;
  }

  // 把实体从 covers 里解嵌出来（被车辆推离后防卡死用）
  unstickFromCovers() {
    const r = this.radius || 13;
    for (let iter = 0; iter < 3; iter++) {  // 最多三轮校正，对付角落连续嵌
      let moved = false;
      for (const c of game.ent.covers) {
        const cx = clamp(this.x, c.x, c.x + c.w);
        const cy = clamp(this.y, c.y, c.y + c.h);
        const d = Math.hypot(this.x - cx, this.y - cy);
        if (d < r && d > 0.0001) {
          const ov = r - d + 0.5;
          this.x += (this.x - cx) / d * ov;
          this.y += (this.y - cy) / d * ov;
          moved = true;
        } else if (d === 0) {
          // 正好在中心，随机方向推开
          const a = Math.random() * Math.PI * 2;
          this.x += Math.cos(a) * (r + 1);
          this.y += Math.sin(a) * (r + 1);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  update(dt) {
    if (this.hp <= 0) return;
    this.updateBleeding(dt);
    if (this.invuln > 0) this.invuln -= dt;
    if (this.energyBoost > 0) this.energyBoost -= dt;

    // 翻滚（增强版：更长无敌帧 + 翻滚后加速）
    if (this.rolling > 0) {
      this.rolling -= dt;
      this.vx = this.rollDir.x * 7;
      this.vy = this.rollDir.y * 7;
      this.invuln = Math.max(this.invuln, 80);  // 无敌帧增强 40→80
      if (this.rolling <= 0) {
        // 翻滚结束后2秒加速buff
        this.rollBoost = 2000;
      }
    }
    if (this.rollBoost > 0) this.rollBoost -= dt;

    // 装弹完成
    if (this.weapon.reloading && game.time >= this.weapon.reloadEnd) {
      this.weapon.reloading = false;
      const w = WEAPONS[this.weapon.type];
      const needed = w.mag - this.weapon.ammo;
      const take = Math.min(needed, this.ammoReserve[this.weapon.type]);
      this.weapon.ammo += take;
      this.ammoReserve[this.weapon.type] -= take;
    }

    // 倒地
    if (this.downed) {
      this.downTimer -= dt;
      if (this.isPlayer) {
        document.getElementById('downedTimer').textContent = Math.max(0, Math.ceil(this.downTimer/1000));
      }
      if (this.downTimer <= 0) this.hp = 0;
    }

    // 移动
    this.x += this.vx * (dt/16.67);
    this.y += this.vy * (dt/16.67);
    this.x = clamp(this.x, this.radius, game.mapW - this.radius);
    this.y = clamp(this.y, this.radius, game.mapH - this.radius);

    // 掩体碰撞
    for (const c of game.ent.covers) {
      const cx = clamp(this.x, c.x, c.x+c.w);
      const cy = clamp(this.y, c.y, c.y+c.h);
      const d = Math.hypot(this.x-cx, this.y-cy);
      if (d < this.radius && d > 0) {
        const ov = this.radius - d;
        this.x += (this.x-cx)/d * ov;
        this.y += (this.y-cy)/d * ov;
      }
    }
    // 实体间避免重叠
    const all = [...game.ent.teammates, ...game.ent.enemies, ...game.ent.gangsters, ...game.ent.players];
    for (const o of all) {
      if (o === this || o.hp <= 0) continue;
      const d = dist(this, o);
      const min = this.radius + o.radius;
      if (d < min && d > 0) {
        const p = (min - d) / 2;
        const ax = (this.x-o.x)/d, ay = (this.y-o.y)/d;
        this.x += ax*p; this.y += ay*p;
        o.x -= ax*p; o.y -= ay*p;
      }
    }
  }

  getSpeed() {
    let sp = this.speed;
    if (this.energyBoost > 0) sp *= 1.3;
    if (this.rollBoost > 0) sp *= 1.4;  // 翻滚后加速
    if (this.legSlowdown > 0) sp *= (1 - this.legSlowdown);
    if (this.downed) sp *= 0.25;
    return sp;
  }

  draw() {
    if (this.hp <= 0) return;
    ctx.save();
    ctx.translate(this.x - game.camera.x, this.y - game.camera.y);
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 5, this.radius, this.radius*0.4, 0, 0, Math.PI*2); ctx.fill();
    if (this.downed) ctx.rotate(game.time * 0.003);
    else ctx.rotate(this.angle);
    const fc = {blue:{b:'#3a6ecf',h:'#4a8ee0',a:'#6ab0ff'},
                 red:{b:'#c23a3a',h:'#e05050',a:'#ff7a7a'},
                 green:{b:'#3a9a4c',h:'#5bbf6e',a:'#8fe69f'}}[this.faction];
    // 身体
    ctx.fillStyle = fc.b;
    ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
    // 头
    ctx.fillStyle = fc.h;
    ctx.beginPath(); ctx.arc(this.radius*0.3, 0, this.radius*0.55, 0, Math.PI*2); ctx.fill();
    // 枪
    if (this.armDisabled <= 0 && !this.downed) {
      ctx.fillStyle = '#222'; ctx.fillRect(this.radius*0.5, -3, 18, 6);
      ctx.fillStyle = fc.a; ctx.fillRect(this.radius*0.5, -3, 4, 6);
    } else if (this.armDisabled > 0) {
      // 手臂受伤闪烁
      ctx.fillStyle = `rgba(255,80,80,${0.5+Math.sin(game.time*0.02)*0.3})`;
      ctx.fillRect(this.radius*0.5, -3, 18, 6);
    }
    // 护甲
    if (this.armor > 0) {
      ctx.strokeStyle = '#4af'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, this.radius+3, 0, Math.PI*2); ctx.stroke();
    }
    // 流血效果
    if (this.wounds.length > 0) {
      ctx.strokeStyle = `rgba(200,30,30,${0.5+Math.sin(game.time*0.01)*0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, this.radius+1, 0, Math.PI*2); ctx.stroke();
    }
    // 无敌闪烁
    if (this.invuln > 0 && Math.floor(this.invuln/40)%2 === 0) {
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, this.radius+1, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // HP 条
    if (!this.isPlayer) {
      const w=30, hx=this.x-game.camera.x-w/2, hy=this.y-game.camera.y-this.radius-14;
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(hx-1, hy-1, w+2, 5);
      ctx.fillStyle = this.hp>50?'#4c4':this.hp>20?'#cc4':'#c44';
      ctx.fillRect(hx, hy, w*(this.hp/this.maxHp), 3);
      if (this.downed) {
        ctx.fillStyle='#f80'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center';
        ctx.fillText('倒地!', this.x-game.camera.x, hy-3);
      }
      if (this.nameTag) {
        ctx.fillStyle='#fff'; ctx.font='10px sans-serif'; ctx.textAlign='center';
        ctx.fillText(this.nameTag, this.x-game.camera.x, hy-8);
      }
    }
    // 能量光环
    if (this.energyBoost > 0) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(game.time*0.015)*0.2;
      ctx.strokeStyle='#ff4'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(this.x-game.camera.x, this.y-game.camera.y, this.radius+7, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
}

// === 玩家 ===
class Player extends Entity {
  constructor(x,y,startWeapon) {
    super(x,y,F_BLUE);
    this.isPlayer=true; this.maxHp=200; this.hp=200; this.speed=2.8; this.armor=60;
    this.ownedWeapons={pistol:true,rifle:false,shotgun:false,sniper:false,smg:false};
    this.ownedWeapons[startWeapon]=true;
    this.ammoReserve={pistol:48,rifle:60,shotgun:18,sniper:10,smg:80};
    this.ammoReserve[startWeapon] += WEAPONS[startWeapon].mag * 2;
    this.weapon={type:startWeapon,ammo:WEAPONS[startWeapon].mag,reloading:false,reloadEnd:0,lastShot:0};
    this.nameTag='你';
  }

  update(dt) {
    const k = game.keys;
    if (this.hp <= 0) { super.update(dt); return; }
    this.angle = Math.atan2(game.mouse.worldY - this.y, game.mouse.worldX - this.x);
    // 移动
    let mx=0,my=0;
    if (k['w']) my--; if (k['s']) my++; if (k['a']) mx--; if (k['d']) mx++;
    const ml = Math.hypot(mx,my);
    if (ml > 0) { mx/=ml; my/=ml; }
    this.sprinting = (k['shift'] && this.stamina > 0 && ml > 0 && !this.downed);
    let sp = this.getSpeed();
    if (this.sprinting && this.rolling <= 0) { sp *= 1.7; this.stamina -= dt*0.05; if(this.stamina<0) this.stamina=0; }
    if (!this.sprinting) this.stamina = Math.min(100, this.stamina + dt*0.02);
    if (this.rolling <= 0) { this.vx = mx*sp; this.vy = my*sp; }
    // 射击
    if (game.mouse.down && !this.downed) {
      const w = WEAPONS[this.weapon.type];
      if (!w.auto) {
        if (!game.mouse.lastDown) this.shootAt(game.mouse.worldX, game.mouse.worldY);
        if (this.weapon.ammo <= 0 && !this.weapon.reloading) this.reload();
      } else {
        this.shootAt(game.mouse.worldX, game.mouse.worldY);
        if (this.weapon.ammo <= 0 && !this.weapon.reloading) this.reload();
      }
    }
    game.mouse.lastDown = game.mouse.down;
    // 自动装弹
    if (this.weapon.ammo === 0 && !this.weapon.reloading && this.ammoReserve[this.weapon.type] > 0) this.reload();
    super.update(dt);
    // 检查互动
    this.checkInteraction();
  }

  checkInteraction() {
    const prompt = document.getElementById('interactPrompt');
    const txt = document.getElementById('interactText');
    let found = null;
    // 互动装置
    for (const d of game.ent.devices) {
      if (dist(this, d) < 40) {
        found = 'device';
        const names = {ammo_crate:'补充弹药', first_aid:'使用急救站 (+50HP)', turret:this.mounted?'离开机枪':'使用固定机枪'};
        txt.textContent = names[d.type] || '互动';
        this._targetDevice = d;
        break;
      }
    }
    // 倒地队友
    if (!found) {
      for (const t of game.ent.teammates) {
        if (t.downed && t.hp > 0 && dist(this, t) < 35) {
          found = 'revive';
          txt.textContent = `救援 ${t.nameTag}`;
          break;
        }
      }
    }
    prompt.style.display = found ? 'block' : 'none';
    this._interactTarget = found;
  }

  interact() {
    if (this._interactTarget === 'device') {
      for (const d of game.ent.devices) {
        if (dist(this, d) < 40) {
          if (d.type === 'ammo_crate') {
            for (const wk of WEAPON_KEYS) {
              if (this.ownedWeapons[wk]) this.ammoReserve[wk] += WEAPONS[wk].mag * 2;
            }
            logMsg('弹药已补充！', '#fc4');
            spawnParticles(this.x, this.y, 10, '#fc4', 2, 400);
          } else if (d.type === 'first_aid') {
            this.heal(100); this.fullyHeal();
            logMsg('急救站治疗 +100HP · 伤口已愈合', '#4f8');
            spawnParticles(this.x, this.y, 12, '#4f8', 2, 500);
          } else if (d.type === 'turret') {
            if (this.mounted) { this.mounted = null; logMsg('离开固定机枪', '#888'); }
            else { this.mounted = d; logMsg('使用固定机枪 (伤害×2.5 · 穿透·无散布)', '#fa4'); }
          }
          return;
        }
      }
    } else if (this._interactTarget === 'revive') {
      for (const t of game.ent.teammates) {
        if (t.downed && t.hp > 0 && dist(this, t) < 35) {
          t.downed = false; t.hp = 50; t.wounds = [];
          logMsg(`你救起了 ${t.nameTag}！`, '#4f8');
          spawnParticles(t.x, t.y, 15, '#4f8', 2, 500);
          return;
        }
      }
    }
    // 无目标时穿甲
    if (!this._interactTarget) {
      if (!this.useItem('armor')) logMsg('没有防弹衣了！', '#f66');
      else logMsg('穿上防弹衣 +80 护甲', '#48f');
    }
  }
}

// === 队友 ===
class Teammate extends Entity {
  constructor(x,y,name,role='老兵') {
    super(x,y,F_BLUE);
    this.speed=2.4; this.nameTag=name;
    this.role = role;
    const ch=['rifle','smg','shotgun','pistol'];
    const pk = ch[randi(0,ch.length)];
    this.ownedWeapons[pk]=true;
    this.weapon={type:pk,ammo:WEAPONS[pk].mag,reloading:false,reloadEnd:0,lastShot:0};
    this.ammoReserve[pk]=120;
    if (pk!=='pistol') { this.ownedWeapons.pistol=true; this.ammoReserve.pistol=60; }
    // 闪避能力（按兵种差异化，同时非专长领域弱化）
    this.dodgeChance = 0.35;
    this.dodgeCD = 0;
    this.aiDodgeTimer = 0;
    // 兵种模板
    this.applyRoleModifiers();
  }

  applyRoleModifiers() {
    // 默认（老兵/综合强）：所有维度 1.0 基准
    // base 基准：速度 2.4, 闪避 35%, 翻滚时长 280ms, 散射 1.0x, 射程偏好 0.85, 救援1.0x
    let speedMul=1, dodgeMul=1, rollLen=280, spreadMul=1, engageMul=0.85, rescueMul=1;
    let medkitBonus=0, bandageBonus=0, smokeBonus=0, grenadeBonus=0;
    let fireRateMul=1, dpsMul=1;
    // 翻滚冷却（越低越频繁），默认 1200ms
    let dodgeCDBase = 1200;
    // 受非专长弱化：比如狙击手近战弱，突击手远程弱…
    let weakMelee=false, weakRanged=false, weakRoll=false, weakHeal=false;

    switch (this.role) {
      case '老兵':
        // 全方位综合强：所有维度略提升 + 无弱点
        speedMul=1.05; dodgeMul=1.25; rollLen=300; spreadMul=0.9; engageMul=0.92;
        rescueMul=1.1; medkitBonus=1; smokeBonus=1; grenadeBonus=1;
        fireRateMul=1.08; dpsMul=1.06;
        dodgeCDBase = 1000;
        break;
      case '突击手':
        // 特别擅长翻滚、近战冲锋强；远程弱
        speedMul=1.18; dodgeMul=1.9; rollLen=400; spreadMul=0.78; engageMul=0.55;
        medkitBonus=1; smokeBonus=2; grenadeBonus=1;
        fireRateMul=1.15; dpsMul=1.1;
        dodgeCDBase = 720;
        weakRanged = true;
        break;
      case '狙击手':
        // 远程精准；近战/翻滚弱
        speedMul=0.92; dodgeMul=0.55; rollLen=220; spreadMul=0.55; engageMul=1.05;
        medkitBonus=0; smokeBonus=1; grenadeBonus=0;
        fireRateMul=0.85; dpsMul=1.0;
        dodgeCDBase = 1700;
        weakMelee = true; weakRoll = true;
        break;
      case '医疗兵':
        // 医疗救援快、冲锋强；远程输出弱
        speedMul=1.12; dodgeMul=1.15; rollLen=300; spreadMul=1.05; engageMul=0.7;
        rescueMul=1.8; medkitBonus=3; bandageBonus=3; smokeBonus=2; grenadeBonus=0;
        fireRateMul=1.0; dpsMul=0.92;
        dodgeCDBase = 1100;
        weakRanged = true;
        break;
      case '支援手':
        // 投掷物多、持续输出强；冲锋弱
        speedMul=0.96; dodgeMul=0.9; rollLen=260; spreadMul=0.88; engageMul=0.9;
        rescueMul=1.1; medkitBonus=1; smokeBonus=3; grenadeBonus=3;
        fireRateMul=1.22; dpsMul=1.12;
        dodgeCDBase = 1350;
        weakRoll = true;
        break;
    }
    this.speed = 2.4 * speedMul;
    this.dodgeChance = 0.35 * dodgeMul;
    this._rollLen = rollLen;
    this._dodgeCDBase = dodgeCDBase;
    this._spreadMul = spreadMul;
    this._engageMul = engageMul;
    this._rescueMul = rescueMul;
    this._fireRateMul = fireRateMul;
    this._dpsMul = dpsMul;
    this._weak = {weakMelee, weakRanged, weakRoll, weakHeal};
    // 物品补充（按兵种）
    this.items.medkit = Math.min(9, this.items.medkit + medkitBonus);
    this.items.bandage = Math.min(12, this.items.bandage + bandageBonus);
    this.items.smoke = Math.min(8, this.items.smoke + smokeBonus);
    this.items.grenade = (this.items.grenade||0) + grenadeBonus;
    this.items.grenade = Math.min(6, this.items.grenade);
  }

  findDownedAlly() {
    // 优先级：玩家 > 最近队友；玩家倒地时距离无上限（全图赶赴救援）
    let best=null, bd=99999;
    const player = game.ent.players[0];
    if (player && player !== this && player.hp > 0 && player.downed) {
      return {target:player, dist:dist(this,player), isPlayer:true};
    }
    const check = [...game.ent.teammates];
    for (const a of check) {
      if (!a || a===this || a.hp<=0 || !a.downed) continue;
      const d = dist(this, a);
      if (d < bd) { bd=d; best=a; }
    }
    return {target:best, dist:bd, isPlayer:false};
  }

  update(dt) {
    // 队友倒地处理：hp=0 且未 downed → 进入倒地；timer 到 0 交给 processDeaths 处理阵亡
    if (this.hp <= 0 && !this.downed) {
      this.downed = true; this.downTimer = 60000; this.hp = 1;
      logMsg(`${this.nameTag} 倒地了！需要救援`, '#f80');
      spawnParticles(this.x, this.y, 12, '#f80', 2, 400);
    }
    if (this.hp <= 0) {
      if (this.downed) {
        this.updateBleeding(dt);
        this.downTimer -= dt;
      }
      return;
    }
    // 闪避冷却
    if (this.dodgeCD > 0) this.dodgeCD -= dt;
    if (this.aiDodgeTimer > 0) this.aiDodgeTimer -= dt;
    // 主动闪避：检测来袭子弹
    if (this.aiDodgeTimer <= 0 && this.rolling <= 0) {
      for (const b of game.ent.bullets) {
        if (b.faction === this.faction) continue;
        const d = dist(this, b);
        if (d > 120) continue;
        // 检查子弹是否朝自己飞来
        const toMe = angleTo(b, this);
        const bulletDir = Math.atan2(b.vy, b.vx);
        let diff = toMe - bulletDir;
        while (diff > Math.PI) diff -= Math.PI*2;
        while (diff < -Math.PI) diff += Math.PI*2;
        if (Math.abs(diff) < 0.5) {
          // 子弹朝自己飞来，翻滚躲避（兵种差异化：翻滚长度/冷却/是否弱化）
          if (this._weak && this._weak.weakRoll && Math.random() < 0.55) { this.aiDodgeTimer = (this._dodgeCDBase||1200) + 400; break; }
          const perpA = bulletDir + Math.PI/2 * (Math.random()<0.5?1:-1);
          this.rolling = (this._rollLen||280);
          this.rollDir = {x:Math.cos(perpA), y:Math.sin(perpA)};
          this.aiDodgeTimer = (this._dodgeCDBase||1200);
          this.invuln = Math.max(this.invuln, 100 + (this.role==='突击手'?40:0));
          break;
        }
      }
    }
    const player = game.ent.players[0];
    if (!player) return;
    // 低血自救：用物品
    if (this.hp < 55 && !this.downed && this.items.medkit > 0) this.useItem('medkit');
    if (this.wounds.length > 0 && Math.random() < 0.01) this.useItem('bandage');
    // 低血且无医疗包：找急救站
    if (this.aiState !== 'rescue' && this.hp < 70 && this.items.medkit === 0) {
      let healTarget = null, hd = 9999;
      for (const d of game.ent.devices) {
        if (d.type === 'first_aid') {
          const dd = dist(this, d);
          if (dd < hd && dd < 1200) { hd = dd; healTarget = d; }
        }
      }
      if (healTarget) {
        if (dist(this, healTarget) < 35) {
          this.heal(100); this.fullyHeal();
          spawnParticles(this.x, this.y, 12, '#4f8', 2, 500);
        } else {
          this.angle = angleTo(this, healTarget);
          this.moveToward(healTarget.x, healTarget.y, dt, 1.0);
          super.update(dt); return;
        }
      }
    }
    // 救援倒地友军（玩家倒地是最高优先级，全图赶赴 + 加速）
    const dc = this.findDownedAlly();
    const playerDying = !!(dc.isPlayer && dc.target);
    if (dc.target && (playerDying || dc.dist < 420)) {
      this.aiState = 'rescue'; this.aiTarget = dc.target;
    }
    if (this.aiState === 'rescue' && dc.target) {
      if (dist(this, dc.target) < 32) {
        // 救玩家更快 + 兵种救援速度加成
        const roleMul = this._rescueMul || 1;
        const revSpeed = (playerDying ? 1.7 : 1.1) * roleMul;
        const revThreshold = playerDying ? 1800 / Math.max(1, roleMul*0.6) : 3000 / Math.max(1, roleMul*0.6);
        this.aiReviveTimer += dt * revSpeed;
        if (this.aiReviveTimer > revThreshold) {
          dc.target.downed = false; dc.target.hp = 55; dc.target.wounds = [];
          logMsg(`${this.nameTag} 救援了 ${dc.target.isPlayer?'你':dc.target.nameTag}！`, '#4f8');
          spawnParticles(dc.target.x, dc.target.y, 15, '#4f8', 2, 500);
          if (dc.target.isPlayer) hideDownedOverlay();
          this.aiState = 'idle'; this.aiReviveTimer = 0;
        }
      } else {
        this.angle = angleTo(this, dc.target);
        // 救玩家 1.4x 速度 + 路上放烟雾弹
        const spd = playerDying ? 1.45 : 1.1;
        this.moveToward(dc.target.x, dc.target.y, dt, spd);
        // 去救玩家路上放烟雾（如果有）
        if (playerDying && this.items.smoke > 0 && dc.dist < 320 && !this._rescueSmoked) {
          this.throwSmoke(dc.target.x, dc.target.y);
          this._rescueSmoked = true;
        }
      }
      super.update(dt); return;
    } else {
      // 取消救援状态时清掉烟雾旗标
      this._rescueSmoked = false;
    }
    // 找敌方
    const enemies = [...game.ent.enemies, ...game.ent.gangsters];
    let target=null, tDist=99999;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const d = dist(this, e);
      if (d > 600) continue;
      // 严格视线检查
      if (!lineOfSight(this.x, this.y, e.x, e.y)) continue;
      // 烟雾：藏到烟雾里就找不到
      if (smokeCoverage(e) > 0.4) continue;
      if (d < tDist) { target=e; tDist=d; }
    }
    this.aiTarget = target;
    if (target) {
      this.angle = angleTo(this, target);
      // 兵种交战距离偏好 + 非专长弱化（近战/远程限制）
      const w = WEAPONS[this.weapon.type];
      const engage = (this._engageMul || 0.85);
      const d = dist(this, target);
      // 兵种交战策略：狙击手遇近距离后撤；突击手遇远程前冲锋
      let holdDistance = false;
      if (this._weak?.weakMelee && d < 120) {
        // 狙击手：近战保持距离
        this.angle = angleTo(target, this);
        this.moveToward(this.x + (this.x-target.x), this.y + (this.y-target.y), dt, 1.05);
        holdDistance = true;
      } else if (this._weak?.weakRanged && d > w.range * engage * 1.1) {
        // 突击手/医疗兵：远程冲锋贴近
        this.moveToward(target.x, target.y, dt, 1.25);
        holdDistance = true;
      }
      if (!holdDistance) {
        // 找掩体
        if (!this.aiCoverPos || dist(this,this.aiCoverPos)<10 || game.time-this.aiMoveTimer>4000) {
          this.aiCoverPos = findCover(this, target);
          this.aiMoveTimer = game.time;
        }
      }
      const canSee = lineOfSight(this.x, this.y, target.x, target.y);
      if (canSee && !holdDistance) {
        if (this.aiCoverPos && dist(this, this.aiCoverPos) > 18) {
          this.moveToward(this.aiCoverPos.x, this.aiCoverPos.y, dt);
        } else {
          if (this.weapon.ammo === 0 && !this.weapon.reloading) this.reload();
          if (d < w.range * engage) {
            // 兵种射速 + 精准度差异化
            const frMul = this._fireRateMul || 1;
            const spread = this._spreadMul || 1;
            // 弱远程 → 远距离射击概率降低、散射加大
            let shotProb = w.auto ? 0.55 : 0.35;
            let spreadMul = spread;
            if (this._weak?.weakRanged && d > w.range * 0.6) { shotProb *= 0.55; spreadMul *= 1.6; }
            if (this._weak?.weakMelee && d < 140) { shotProb *= 0.55; spreadMul *= 1.5; }
            // 狙击手：远程反而更准
            if (this.role === '狙击手' && d > w.range * 0.5) { spreadMul *= 0.75; shotProb *= 1.2; }
            // 突击手：近距离更准更猛
            if (this.role === '突击手' && d < w.range * 0.55) { spreadMul *= 0.7; shotProb *= 1.35; }
            // 支援手：持续输出 - 射速加成
            if (this.role === '支援手') { shotProb *= 1.15; }
            // 实际射击间隔检查（避免 frMul 没地方用）
            const fireDelay = w.fireRate / Math.max(0.5, frMul);
            if (game.time - this.weapon.lastShot >= fireDelay * (0.9 + Math.random()*0.2)) {
              const baseJitter = w.auto ? 18 : 12;
              const jx = rand(-baseJitter, baseJitter) * spreadMul;
              const jy = rand(-baseJitter, baseJitter) * spreadMul;
              if (Math.random() < shotProb) {
                this.shootAt(target.x+jx, target.y+jy, this._dpsMul || 1);
              }
            }
          }
        }
      } else if (!holdDistance) {
        if (this.aiCoverPos) this.moveToward(this.aiCoverPos.x, this.aiCoverPos.y, dt);
        else this.moveToward(target.x, target.y, dt, 0.7);
      }
    } else {
      // 跟随玩家
      const d = dist(this, player);
      if (d > 120) {
        this.angle = angleTo(this, player);
        this.moveToward(player.x+rand(-40,40), player.y+rand(-40,40), dt, 0.85);
      } else { this.vx *= 0.9; this.vy *= 0.9; }
    }
    super.update(dt);
  }

  moveToward(tx,ty,dt,sm=1) {
    const a = angleTo(this,{x:tx,y:ty});
    const d = dist(this,{x:tx,y:ty});
    if (d < 3) { this.vx *= 0.9; this.vy *= 0.9; return; }
    const sp = this.getSpeed() * sm;
    this.vx += Math.cos(a)*sp*0.3; this.vy += Math.sin(a)*sp*0.3;
    this.vx = clamp(this.vx, -sp, sp); this.vy = clamp(this.vy, -sp, sp);
  }
}

// === 敌方 (严格视线 + 战术) ===
class Enemy extends Entity {
  constructor(x,y,faction=F_RED,tier=1) {
    super(x,y,faction);
    this.speed = 2.0 + tier*0.1;
    this.maxHp = 80 + tier*25; this.hp = this.maxHp;
    this.tier = tier;
    const tw = {1:['pistol','pistol','smg'], 2:['smg','rifle','shotgun'], 3:['rifle','rifle','sniper']}[tier]||['pistol'];
    const pk = tw[randi(0,tw.length)];
    this.ownedWeapons[pk] = true;
    this.weapon = {type:pk,ammo:WEAPONS[pk].mag,reloading:false,reloadEnd:0,lastShot:0};
    this.ammoReserve[pk] = tier===3 ? 180 : 100;
    this.items.grenade = tier>=2 ? randi(1,3) : 0;
    this.aiFlankTimer = game.time + rand(3000,7000);
    this.nameTag = faction===F_RED ? `士兵${randi(10,99)}` : `帮派${randi(10,99)}`;
  }

  update(dt) {
    if (this.hp <= 0) return;
    if (this.hp < 30 && !this.downed && Math.random() < 0.006) this.useItem('medkit');
    if (this.wounds.length > 0 && Math.random() < 0.003) this.useItem('bandage');
    if (this.hp < 25 && !this.aiRetreating && !this.downed) this.aiRetreating = true;
    if (this.aiRetreating && this.hp > 60) this.aiRetreating = false;

    // 找所有敌方阵营
    const hostiles = [...game.ent.players, ...game.ent.teammates,
                      ...(this.faction===F_RED ? game.ent.gangsters : game.ent.enemies)];
    let target=null, bestScore=-Infinity;
    for (const e of hostiles) {
      if (e.hp <= 0) continue;
      const d = dist(this, e);
      if (d > 600) continue;  // 缩小检测范围至玩家可视范围内
      const canSee = lineOfSight(this.x, this.y, e.x, e.y);
      if (!canSee) continue;   // 必须真正有视线才能作为目标
      // 烟雾：被烟雾覆盖>0.4的目标找不到（藏到烟雾里了）
      const sc = smokeCoverage(e);
      if (sc > 0.4) continue;
      this.lastSeen[e.faction] = {x:e.x, y:e.y, time:game.time};
      let score = -d*0.4;
      if (e.downed) score -= 400;
      if (e.isPlayer) score += 80;
      if (canSee) score += 400;
      if (e.hp < 40) score += 50;
      score -= sc * 100;  // 有烟雾则降低优先级
      if (score > bestScore) { bestScore = score; target = e; }
    }
    if (!target) {
      for (const f in this.lastSeen) {
        if (f === this.faction) continue;
        const r = this.lastSeen[f];
        if (game.time - r.time > 7000) continue;
        target = {x:r.x, y:r.y, _phantom:true, hp:1};
        break;
      }
    }
    this.aiTarget = target;
    if (!target) {
      if (!this._patrol || dist(this, this._patrol) < 15) {
        this._patrol = {x:clamp(this.x+rand(-400,400),80,game.mapW-80), y:clamp(this.y+rand(-400,400),80,game.mapH-80)};
      }
      this.angle = angleTo(this, this._patrol);
      this.moveToward(this._patrol.x, this._patrol.y, dt, 0.5);
      super.update(dt); return;
    }

    this.angle = angleTo(this, target._phantom ? target : {x:target.x,y:target.y});
    const d = dist(this, target);
    const canSee = !target._phantom && lineOfSight(this.x, this.y, target.x, target.y);

    if (this.aiRetreating) {
      const awayA = angleTo(target, this);
      const sp = this.getSpeed() * 1.3;
      this.vx += Math.cos(awayA)*sp*0.3; this.vy += Math.sin(awayA)*sp*0.3;
      this.vx = clamp(this.vx, -sp, sp); this.vy = clamp(this.vy, -sp, sp);
      if (this.items.smoke > 0 && Math.random() < 0.005) this.useItem('smoke');
      super.update(dt); return;
    }

    if (this.aiSuppressing) {
      this.aiSuppressTimer -= dt;
      if (this.aiSuppressTimer <= 0) this.aiSuppressing = false;
    }
    if (game.time > this.aiFlankTimer) {
      this.aiFlankSide = Math.random()<0.5?1:-1;
      this.aiFlankTimer = game.time + rand(3500,7000);
    }

    // 核心修复：只有看到才射击
    if (canSee) {
      // 扔手雷
      if (this.items.grenade > 0 && d < 260 && d > 80 && Math.random() < 0.003) {
        this.throwGrenade(target.x, target.y);
        this.items.grenade--;
      }
      if (this.weapon.ammo === 0 && !this.weapon.reloading) this.reload();
      const w = WEAPONS[this.weapon.type];
      if (this.weapon.ammo > 0 && !this.weapon.reloading && this.armDisabled <= 0) {
        if (game.time - this.weapon.lastShot >= w.fireRate) {
          if (d < w.range * 0.9) {
            // 大幅降低命中率：远距离更难命中
            const accPenalty = d > 400 ? 1.5 : 1.0;
            const spread = (w.spread + 0.15) * accPenalty;
            if (w.auto) { if (Math.random()<0.30) this.shootAt(target.x+rand(-35,35), target.y+rand(-35,35)); }
            else if (this.weapon.type==='shotgun') { if (d<250 && Math.random()<0.25) this.shootAt(target.x+rand(-18,18), target.y+rand(-18,18)); }
            else { if (Math.random()<0.22) this.shootAt(target.x+rand(-25,25), target.y+rand(-25,25)); }
          }
        }
      }
      // 移动战术
      const idealD = this.weapon.type==='sniper'?620 : this.weapon.type==='shotgun'?120 : this.weapon.type==='smg'?200:320;
      const toA = angleTo(this, target);
      const flankA = toA + this.aiFlankSide * Math.PI/2;
      const distA = d > idealD+50 ? toA : d < idealD-50 ? toA+Math.PI : null;
      if (!this.aiCoverPos || game.time-this.aiMoveTimer > 3000+Math.random()*2000) {
        this.aiCoverPos = findCover(this, target);
        this.aiMoveTimer = game.time;
      }
      let moved = false;
      if (this.aiCoverPos && Math.random() < 0.35 && dist(this, this.aiCoverPos) > 25) {
        this.moveToward(this.aiCoverPos.x, this.aiCoverPos.y, dt, 0.9);
        moved = true;
      }
      if (!moved) {
        let vx=0, vy=0;
        if (distA !== null) { vx += Math.cos(distA); vy += Math.sin(distA); }
        if (Math.random() < 0.3) { vx += Math.cos(flankA)*0.8; vy += Math.sin(flankA)*0.8; }
        const ml = Math.hypot(vx, vy);
        if (ml > 0) {
          vx/=ml; vy/=ml;
          const sp = this.getSpeed() * (this.aiSuppressing ? 0.3 : 0.9);
          this.vx += vx*sp*0.25; this.vy += vy*sp*0.25;
          this.vx = clamp(this.vx, -sp, sp); this.vy = clamp(this.vy, -sp, sp);
        } else { this.vx *= 0.9; this.vy *= 0.9; }
      }
      if (this.tier >= 2 && !this.aiSuppressing && Math.random() < 0.002) {
        this.aiSuppressing = true; this.aiSuppressTimer = 1500;
      }
    } else {
      const dest = target._phantom ? target : this.lastSeen[target.faction];
      if (dest) this.moveToward(dest.x, dest.y, dt, 0.8);
      else { this.vx *= 0.9; this.vy *= 0.9; }
    }
    super.update(dt);
  }

  throwGrenade(tx,ty) {
    const a = angleTo(this,{x:tx,y:ty});
    const dd = Math.min(dist(this,{x:tx,y:ty}), 260);
    game.ent.grenades.push({x:this.x+Math.cos(a)*18, y:this.y+Math.sin(a)*18,
      vx:Math.cos(a)*(dd/45), vy:Math.sin(a)*(dd/45), faction:this.faction,
      fuse:1500, dmg:65, radius:95});
  }
  throwSmoke(tx,ty) {
    if (this.items.smoke <= 0) return false;
    this.items.smoke--;
    const a = angleTo(this,{x:tx,y:ty});
    const dd = Math.min(dist(this,{x:tx,y:ty}), 220);
    game.ent.smokes.push({
      x:this.x+Math.cos(a)*18, y:this.y+Math.sin(a)*18,
      vx:Math.cos(a)*(dd/40), vy:Math.sin(a)*(dd/40),
      fuse:600, radius:110, life:14000, faction:this.faction
    });
    return true;
  }

  moveToward(tx,ty,dt,sm=1) {
    const a = angleTo(this,{x:tx,y:ty});
    const d = dist(this,{x:tx,y:ty});
    if (d < 3) { this.vx *= 0.9; this.vy *= 0.9; return; }
    const sp = this.getSpeed() * sm;
    this.vx += Math.cos(a)*sp*0.25; this.vy += Math.sin(a)*sp*0.25;
    this.vx = clamp(this.vx, -sp, sp); this.vy = clamp(this.vy, -sp, sp);
  }
}

// === 地图构建 ===
function buildMap(mapType) {
  const mapInfo = MAPS[mapType];
  game.mapW = mapInfo.w; game.mapH = mapInfo.h;
  game.ent.covers = []; game.ent.devices = []; game.ent.barrels = [];
  const C = game.ent.covers;
  const W = mapInfo.w, H = mapInfo.h;

  if (mapType === 'city') {
    // 建筑
    const buildings = [
      [60,60,400,300],[560,60,320,220],[980,60,360,280],[1450,60,420,240],[2000,60,600,320],
      [60,H-360,520,300],[680,H-420,380,380],[1180,H-320,440,260],[1740,H-360,400,300],[2280,H-380,360,320],
      [120,520,80,28],[620,520,80,28],[1100,520,80,28],[1600,520,80,28],[2100,520,80,28]
    ];
    for (const [x,y,w,h] of buildings) C.push({type:'wall',x,y,w,h,sightBlock:true,providesCover:true,color:'#445066'});
    // 车辆
    const cars = [[240,560,90,45],[440,680,90,45],[820,620,90,45],[1150,560,90,45],
      [1500,700,90,45],[1820,620,90,45],[2180,580,90,45],[350,1150,45,90],
      [760,1200,90,45],[1300,1150,45,90],[1720,1250,90,45],[2200,1180,45,90]];
    for (const c of cars) C.push({type:'car',x:c[0],y:c[1],w:c[2],h:c[3],sightBlock:true,providesCover:true,
      color:['#2a3b6b','#6b2a3b','#2a6b3b','#6b602a','#444'][randi(0,5)]});
    // 货箱
    for (const [x,y] of [[140,820],[140,900],[620,800],[620,920],[1040,790],
      [1480,850],[1960,810],[2360,830],[2360,910],[120,1300],[540,1350],[980,1320],
      [1420,1350],[1860,1320],[2260,1350]])
      C.push({type:'crate',x,y,w:34,h:34,sightBlock:true,providesCover:true,color:'#8a6a3a'});
    // 医疗站（3处，稳定无bug）
    game.ent.devices.push({x:1800,y:400,type:'first_aid'});
    game.ent.devices.push({x:400,y:700,type:'first_aid'});
    game.ent.devices.push({x:3200,y:1400,type:'first_aid'});
    // 互动装置
    game.ent.devices.push({x:700,y:460,type:'ammo_crate'});
    game.ent.devices.push({x:1400,y:720,type:'first_aid'});
    game.ent.devices.push({x:2100,y:900,type:'turret'});
    game.ent.devices.push({x:400,y:1100,type:'first_aid'});
    // 爆炸桶
    game.ent.barrels.push({x:900,y:700},{x:1600,y:900},{x:2000,y:1200},{x:500,y:800});
  }
  else if (mapType === 'warehouse') {
    // 外墙
    C.push({type:'wall',x:0,y:0,w:W,h:30,sightBlock:true,providesCover:true,color:'#555'});
    C.push({type:'wall',x:0,y:H-30,w:W,h:30,sightBlock:true,providesCover:true,color:'#555'});
    C.push({type:'wall',x:0,y:0,w:30,h:H,sightBlock:true,providesCover:true,color:'#555'});
    C.push({type:'wall',x:W-30,y:0,w:30,h:H,sightBlock:true,providesCover:true,color:'#555'});
    // 货架/隔间
    const shelves = [
      [120,120,200,40],[400,120,200,40],[700,120,200,40],[1000,120,200,40],[1300,120,200,40],[1600,120,200,40],[1900,120,200,40],[2200,120,200,40],[2500,120,200,40],[2800,120,200,40],
      [120,H-160,200,40],[400,H-160,200,40],[700,H-160,200,40],[1000,H-160,200,40],[1300,H-160,200,40],[1600,H-160,200,40],[1900,H-160,200,40],[2200,H-160,200,40],[2500,H-160,200,40],[2800,H-160,200,40],
      [120,400,40,300],[120,800,40,300],[600,500,40,250],[1200,350,40,300],[1200,800,40,300],
      [1800,500,40,250],[2400,350,40,300],[2400,800,40,300],[3000,500,40,300],[3000,900,40,300]
    ];
    for (const [x,y,w,h] of shelves) C.push({type:'wall',x,y,w,h,sightBlock:true,providesCover:true,color:'#5a4a3a'});
    // 货箱堆
    for (let i=0; i<30; i++) {
      const x = 200 + randi(0,16)*200 + rand(-30,30);
      const y = 300 + randi(0,9)*200 + rand(-30,30);
      C.push({type:'crate',x,y,w:40,h:40,sightBlock:true,providesCover:true,color:'#8a6a3a'});
    }
    // 集装箱
    for (const [x,y] of [[400,700],[1000,600],[1500,700],[2000,650],[2600,700],[3200,600]])
      C.push({type:'wall',x,y,w:120,h:80,sightBlock:true,providesCover:true,color:'#3a4a6a'});
    // 医疗站（3处）
    game.ent.devices.push({x:3200,y:400,type:'first_aid'});
    game.ent.devices.push({x:300,y:900,type:'first_aid'});
    game.ent.devices.push({x:2800,y:1800,type:'first_aid'});
    game.ent.devices.push({x:800,y:600,type:'ammo_crate'});
    game.ent.devices.push({x:1600,y:900,type:'first_aid'});
    game.ent.devices.push({x:2800,y:700,type:'turret'});
    game.ent.devices.push({x:500,y:1000,type:'first_aid'});
    game.ent.barrels.push({x:700,y:900},{x:1400,y:700},{x:2200,y:900},{x:2900,y:1000});
  }
  else { // industrial
    // 集装箱排列
    const containerPositions = [];
    for (let row=0; row<5; row++) {
      for (let col=0; col<8; col++) {
        if ((row+col) % 3 === 0) continue;
        const x = 200 + col * 500 + rand(-20,20);
        const y = 200 + row * 500 + rand(-20,20);
        const colors = ['#3a4a6a','#6a3a3a','#3a6a4a','#6a6a3a','#4a3a6a'];
        C.push({type:'wall',x,y,w:140,h:80,sightBlock:true,providesCover:true,color:colors[randi(0,5)]});
      }
    }
    // 储油罐 (大圆形→方碰撞)
    for (const [x,y] of [[800,1500],[1800,2200],[3000,1600],[3500,800]])
      C.push({type:'wall',x,y,w:100,h:100,sightBlock:true,providesCover:true,color:'#555'});
    // 车辆
    for (const c of [[500,400,90,45],[1200,900,90,45],[2000,500,90,45],[2800,1200,90,45],[3500,2000,90,45]])
      C.push({type:'car',x:c[0],y:c[1],w:c[2],h:c[3],sightBlock:true,providesCover:true,color:'#444'});
    // 医疗站（3处）
    game.ent.devices.push({x:3200,y:2200,type:'first_aid'});
    game.ent.devices.push({x:500,y:2000,type:'first_aid'});
    game.ent.devices.push({x:3800,y:500,type:'first_aid'});
    game.ent.devices.push({x:1000,y:600,type:'ammo_crate'});
    game.ent.devices.push({x:2000,y:1800,type:'first_aid'});
    game.ent.devices.push({x:3500,y:1200,type:'turret'});
    game.ent.devices.push({x:600,y:2200,type:'first_aid'});
    game.ent.devices.push({x:3000,y:500,type:'ammo_crate'});
    game.ent.barrels.push({x:900,y:800},{x:1700,y:1000},{x:2400,y:1500},{x:3200,y:800},{x:1500,y:2200});
  }

  // 拾取物
  game.ent.pickups = [];
  const addP = (x,y,t) => game.ent.pickups.push({x,y,type:t,r:14});
  // 武器
  addP(600,420,'weapon_sniper'); addP(1400,400,'weapon_shotgun');
  addP(2200,620,'weapon_rifle'); addP(400,1100,'weapon_smg');
  addP(1600,1150,'weapon_sniper'); addP(2800,800,'weapon_smg');
  // 道具
  const spots = [
    [180,500,'medkit'],[800,380,'medkit'],[1300,640,'medkit'],[1900,420,'medkit'],
    [2200,900,'medkit'],[300,1050,'medkit'],[1050,890,'medkit'],[1700,1000,'medkit'],
    [250,900,'bandage'],[950,830,'bandage'],[1600,900,'bandage'],[2200,500,'bandage'],
    [420,650,'armor'],[1100,620,'armor'],[1850,800,'armor'],[1350,930,'armor'],
    [250,900,'energy'],[950,830,'energy'],[1600,900,'energy'],[2400,600,'energy'],
    [2150,600,'smoke'],[500,900,'smoke'],[1200,780,'smoke'],[2000,1100,'smoke'],
    [1750,660,'ammo'],[850,1050,'ammo'],[2000,860,'ammo'],[130,420,'ammo'],
    [1380,1100,'ammo'],[2800,1000,'ammo']
  ];
  for (const [x,y,t] of spots) addP(x,y,t);
}

// === 初始化 ===
function initGame() {
  const mapInfo = MAPS[game.selectedMap];
  buildMap(game.selectedMap);
  const ps = mapInfo.playerSpawn;
  const player = new Player(ps[0], ps[1], game.selectedWeapon);
  game.ent.players.push(player);

  // 撤离点（撤离模式）
  game.extraction.active = false;
  game.extraction.entryTimer = 0;
  game.extraction.killGoal = mapInfo.info.includes('专家') ? 40 : mapInfo.info.includes('困难') ? 30 : 22;
  // 撤离点放地图反方向（对角区），确保有撤离过程
  game.extraction.x = clamp(mapInfo.w - ps[0] + rand(-200,200), 250, mapInfo.w - 250);
  game.extraction.y = clamp(mapInfo.h - ps[1] + rand(-200,200), 200, mapInfo.h - 200);

  // 队友（5人小队）
  const squad = [
    {name:'老兵张伟',   wp:'rifle',   dx:-50, dy:40,  role:'老兵'},    // 全方位综合强，非专长不减
    {name:'医疗兵小李', wp:'smg',     dx:50,  dy:40,  role:'医疗兵'},  // 医疗救援强、近距离冲锋强；远程弱
    {name:'狙击手阿坤', wp:'sniper',  dx:-60, dy:-20, role:'狙击手'},  // 远程精准；近战/翻滚弱
    {name:'突击手老王', wp:'shotgun', dx:60,  dy:-20, role:'突击手'},  // 近战+翻滚特别擅长；远程弱
    {name:'支援手大刘', wp:'rifle',   dx:0,   dy:60,  role:'支援手'},  // 扔投掷物+持续输出强；冲锋弱
  ];
  squad.forEach(s => {
    const tm = new Teammate(ps[0]+s.dx, ps[1]+s.dy, s.name, s.role);
    tm.ownedWeapons[s.wp] = true;
    tm.switchWeapon(s.wp);
    tm.ammoReserve[s.wp] = 150;
    game.ent.teammates.push(tm);
  });
  // 敌军（每个出生点生成2个，确保数量充足）
  for (let i=0; i<mapInfo.enemySpawns.length; i++) {
    const [x,y] = mapInfo.enemySpawns[i];
    for (let k=0; k<2; k++) {
      const tier = i===0 && k===0 ? 3 : (i<2 ? 2 : 1);
      game.ent.enemies.push(new Enemy(x+rand(-40,40), y+rand(-40,40), F_RED, tier));
    }
  }
  // 帮派（每个出生点生成2个）
  for (let i=0; i<mapInfo.gangSpawns.length; i++) {
    const [x,y] = mapInfo.gangSpawns[i];
    for (let k=0; k<2; k++) {
      const tier = i<1 && k===0 ? 2 : 1;
      game.ent.gangsters.push(new Enemy(x+rand(-40,40), y+rand(-40,40), F_GREEN, tier));
    }
  }
  updateHUD();
}

// === 子弹 ===
function updateBullets(dt) {
  const bs = game.ent.bullets;
  // 子弹上限：超过350丢最旧的（远距离/快过期的优先）
  if (bs.length > 350) {
    const overflow = bs.length - 300;
    bs.splice(0, overflow);
  }
  for (let i=bs.length-1; i>=0; i--) {
    const b = bs[i];
    b.x += b.vx*(dt/16.67); b.y += b.vy*(dt/16.67);
    b.traveled += Math.hypot(b.vx,b.vy)*(dt/16.67);
    b.life -= dt;
    if (b.life<=0 || b.traveled>b.range || b.x<0||b.x>game.mapW||b.y<0||b.y>game.mapH) { bs.splice(i,1); continue; }
    // 爆炸桶（距离粗过滤：>30跳过）
    for (let j=game.ent.barrels.length-1; j>=0; j--) {
      const br = game.ent.barrels[j];
      if (Math.abs(b.x-br.x) > 20 || Math.abs(b.y-br.y) > 20) continue;
      if (Math.hypot(b.x-br.x, b.y-br.y) < 16) {
        explodeBarrel(j);
        bs.splice(i,1); break;
      }
    }
    if (!bs[i]) continue;
    // 掩体（AABB 粗过滤，大部分cover直接跳过）
    let blocked = false;
    for (const c of game.ent.covers) {
      if (b.x < c.x-10 || b.x > c.x+c.w+10 || b.y < c.y-10 || b.y > c.y+c.h+10) continue;
      if (b.x>c.x && b.x<c.x+c.w && b.y>c.y && b.y<c.y+c.h) {
        if (c.sightBlock) { spawnParticles(b.x,b.y,4,'#aaa',2,200); blocked=true; break; }
      }
    }
    if (blocked) { bs.splice(i,1); continue; }
    // 碰人
    const targets = [...game.ent.players, ...game.ent.teammates, ...game.ent.enemies, ...game.ent.gangsters];
    let hit = false;
    for (const t of targets) {
      if (t.hp<=0 || b.hit.has(t)) continue;
      if (!isEnemy(b.faction, t.faction)) continue;
      if (Math.hypot(b.x-t.x, b.y-t.y) < t.radius) {
        t.takeDamage(b.dmg, b, b.angle);
        b.hit.add(t);
        if (b.pen > 0) b.pen--; else { hit=true; break; }
      }
    }
    if (hit) { bs.splice(i,1); continue; }
  }
}

function explodeBarrel(idx) {
  const br = game.ent.barrels[idx];
  spawnParticles(br.x, br.y, 30, '#f80', 7, 500);
  spawnParticles(br.x, br.y, 15, '#ff4', 5, 400);
  const all = [...game.ent.players, ...game.ent.teammates, ...game.ent.enemies, ...game.ent.gangsters];
  for (const t of all) {
    if (t.hp <= 0) continue;
    const d = dist(br, t);
    if (d < 100) t.takeDamage(70 * (1-d/100), {x:br.x,y:br.y,angle:0}, 0);
  }
  // 连锁爆炸
  for (let j=game.ent.barrels.length-1; j>=0; j--) {
    if (j === idx) continue;
    if (dist(br, game.ent.barrels[j]) < 120) {
      setTimeout(() => { if (game.ent.barrels[j]) explodeBarrel(j); }, 100);
    }
  }
  game.ent.barrels.splice(idx, 1);
}

// === 手雷 & 烟雾 ===
function updateGrenades(dt) {
  for (let i=game.ent.grenades.length-1; i>=0; i--) {
    const g = game.ent.grenades[i];
    g.x += g.vx*(dt/16.67); g.y += g.vy*(dt/16.67);
    g.vx *= 0.96; g.vy *= 0.96; g.fuse -= dt;
    if (g.fuse <= 0) {
      spawnParticles(g.x, g.y, 30, '#f80', 7, 500);
      const all = [...game.ent.players, ...game.ent.teammates, ...game.ent.enemies, ...game.ent.gangsters];
      for (const t of all) {
        if (t.hp <= 0) continue;
        const d = dist(g, t);
        if (d < g.radius) t.takeDamage(g.dmg*(1-d/g.radius), {x:g.x,y:g.y,angle:0}, 0);
      }
      game.ent.grenades.splice(i, 1);
    }
  }
}
function updateSmokes(dt) {
  for (let i=game.ent.smokes.length-1; i>=0; i--) {
    const s = game.ent.smokes[i];
    if (s.fuse > 0) {
      const step = s.vx*(dt/16.67);
      s.x += step; s.y += s.vy*(dt/16.67);
      s.traveled = (s.traveled||0) + Math.abs(step);
      // 到旅行距离或减速后停下，立即爆开
      if (s.traveled > (s.travelDist||0) || (Math.abs(s.vx)<1 && Math.abs(s.vy)<1)) {
        s.fuse = 0; s.vx=0; s.vy=0;
      } else {
        s.vx*=0.93; s.vy*=0.93; s.fuse -= dt;
      }
    }
    else s.life -= dt;
    if (s.life <= 0) game.ent.smokes.splice(i, 1);
  }
}

// 检查实体是否在烟雾中（返回0~1，1表示完全在烟雾中心）
function smokeCoverage(ent) {
  let max = 0;
  for (const s of game.ent.smokes) {
    if (s.fuse > 0) continue;
    const d = Math.hypot(ent.x-s.x, ent.y-s.y);
    if (d < s.radius) {
      const c = 1 - (d / s.radius);  // 中心=1, 边缘=0
      if (c > max) max = c;
    }
  }
  return max;
}

// === 拾取 ===
function updatePickups() {
  const pickable = [game.ent.players[0], ...game.ent.teammates, ...game.ent.enemies, ...game.ent.gangsters].filter(e => e && e.hp > 0);
  for (let i=game.ent.pickups.length-1; i>=0; i--) {
    const it = game.ent.pickups[i];
    for (const t of pickable) {
      if (Math.hypot(t.x-it.x, t.y-it.y) < t.radius + it.r) {
        if (applyPickup(t, it.type)) {
          if (t.isPlayer) showPickupMsg(it.type);
          game.ent.pickups.splice(i, 1); break;
        }
      }
    }
  }
}
function applyPickup(e, type) {
  switch(type) {
    case 'medkit': if (e.items.medkit >= 3) return false; e.items.medkit++; return true;
    case 'bandage': if (e.items.bandage >= 3) return false; e.items.bandage++; return true;
    case 'armor': if (e.items.armor >= 2) return false; e.items.armor++; return true;
    case 'energy': if (e.items.energy >= 3) return false; e.items.energy++; return true;
    case 'smoke': if (e.items.smoke >= 3) return false; e.items.smoke++; return true;
    case 'ammo':
      let got=false;
      for (const k of WEAPON_KEYS) { if (e.ownedWeapons[k]) { e.ammoReserve[k] += WEAPONS[k].mag*2; got=true; } }
      return got;
    default:
      if (type.startsWith('weapon_')) {
        const wt = type.slice(7);
        if (e.ownedWeapons[wt]) { e.ammoReserve[wt] += WEAPONS[wt].mag*2; return true; }
        else { e.ownedWeapons[wt]=true; e.ammoReserve[wt]=WEAPONS[wt].mag*3; return true; }
      }
  }
  return false;
}
function showPickupMsg(type) {
  const m = {medkit:'💊 医疗包',bandage:'🩹 绷带',armor:'🛡 防弹衣',energy:'🥤 能量饮料',
    smoke:'💨 烟雾弹',ammo:'📦 弹药补给',weapon_pistol:'🔫 手枪',weapon_rifle:'🎖 步枪',
    weapon_shotgun:'💥 霰弹枪',weapon_sniper:'🎯 狙击枪',weapon_smg:'⚡ 冲锋枪'};
  logMsg('获得: ' + (m[type]||type), '#4fa');
}

// === 粒子 ===
function updateParticles(dt) {
  for (let i=game.ent.particles.length-1; i>=0; i--) {
    const p = game.ent.particles[i];
    p.x += p.vx*(dt/16.67); p.y += p.vy*(dt/16.67);
    p.vx *= 0.95; p.vy *= 0.95; p.life -= dt;
    if (p.life <= 0) game.ent.particles.splice(i, 1);
  }
  // 浮动文字
  for (let i=game.ent.hitMarkers.length-1; i>=0; i--) {
    const m = game.ent.hitMarkers[i];
    m.y += m.vy*(dt/16.67); m.life -= dt;
    if (m.life <= 0) game.ent.hitMarkers.splice(i, 1);
  }
  // 伤害方向
  for (let i=game.ent.dmgIndicators.length-1; i>=0; i--) {
    game.ent.dmgIndicators[i].life -= dt;
    if (game.ent.dmgIndicators[i].life <= 0) game.ent.dmgIndicators.splice(i, 1);
  }
}

// === 死亡处理 ===
function processDeaths() {
  for (const {list, reward} of [
    {list:game.ent.enemies, reward:50}, {list:game.ent.gangsters, reward:30}
  ]) {
    for (let i=list.length-1; i>=0; i--) {
      const e = list[i];
      if (e.hp <= 0) {
        spawnParticles(e.x, e.y, 18, '#c22', 3.5, 600);
        spawnBloodstain(e.x, e.y, 3);
        if (reward > 0) {
          game.money += reward; game.kills++;
          logMsg(`击杀 ${e.nameTag}！+$${reward}`, '#fa4');
          const r = Math.random();
          if (r < 0.2) dropItem(e.x, e.y, 'medkit');
          else if (r < 0.35) dropItem(e.x, e.y, 'ammo');
          else if (r < 0.45) dropItem(e.x, e.y, 'armor');
          else if (r < 0.52) dropItem(e.x, e.y, 'bandage');
          else if (r < 0.58) dropItem(e.x, e.y, 'energy');
          // 闪避充能：40%概率获得
          const p = game.ent.players[0];
          if (p && p.dodgeCharges < p.maxDodgeCharges && Math.random() < 0.40) {
            p.dodgeCharges++;
            spawnHitMarker(p.x, p.y-25, '+闪避充能', '#4cf');
          }
        }
        list.splice(i, 1);
      }
    }
  }
  // 队友：HP 清零先进入倒地（60s 等待救援），downTimer<=0 或 失血过多才阵亡
  for (let i=game.ent.teammates.length-1; i>=0; i--) {
    const tm = game.ent.teammates[i];
    // downed 时 hp 设为 1 保持 alive 逻辑；真正阵亡标志是：hp 归零 且 downed=false(没来及进入倒地)，或 downTimer<=0
    const reallyDead = (tm.hp <= 0 && !tm.downed) || (tm.downed && tm.downTimer <= 0);
    if (reallyDead) {
      logMsg(`${tm.nameTag} 阵亡了`, '#f66');
      spawnParticles(tm.x, tm.y, 18, '#c22', 3, 600);
      spawnBloodstain(tm.x, tm.y, 3);
      game.ent.teammates.splice(i, 1);
    }
  }
  // 玩家死亡 → 倒地状态已处理
  const p = game.ent.players[0];
  if (p && p.hp <= 0 && !p.downed && !game.over) endGame(false);
}
function dropItem(x,y,type) { game.ent.pickups.push({x:x+rand(-10,10), y:y+rand(-10,10), type, r:12}); }

// === 增援 ===
let nextReinforce = 18000;
function updateReinforcements() {
  if (game.time < nextReinforce) return;
  nextReinforce += 18000;
  // 撤离模式：共5波，波次够了直接return
  if (game.selectedMode === 'extraction') {
    game._reinfWaveCount = (game._reinfWaveCount || 0) + 1;
    if (game._reinfWaveCount > 5) return;
  }
  const mi = MAPS[game.selectedMap];
  const spawn = (faction, count) => {
    for (let i=0; i<count; i++) {
      const spawns = faction===F_RED ? mi.enemySpawns : mi.gangSpawns;
      const [x,y] = spawns[i % spawns.length];
      const tier = Math.random()<0.3 ? 2 : 1;
      const e = new Enemy(x+rand(-40,40), y+rand(-40,40), faction, tier);
      if (faction===F_RED) game.ent.enemies.push(e);
      else game.ent.gangsters.push(e);
    }
  };
  const rn = randi(3,6), gn = randi(2,4);
  spawn(F_RED, rn); spawn(F_GREEN, gn);
  logMsg(`⚠ 增援到达: 敌军+${rn} / 帮派+${gn}`, '#f66');
}

// === 渲染 ===
function render() {
  drawFloor();
  drawSmokes();
  drawCovers();
  drawDevices();
  drawPickups();
  drawExtractionZone();
  const drawables = [...game.ent.players, ...game.ent.teammates, ...game.ent.enemies, ...game.ent.gangsters]
    .filter(e => e.hp > 0).sort((a,b) => a.y - b.y);
  for (const e of drawables) {
    const sc = smokeCoverage(e);
    // 烟雾覆盖度>0.6时完全不可见；边缘(0.2~0.6)渐变透明
    if (sc > 0.6) continue;
    const alpha = sc > 0.2 ? (1 - (sc-0.2)/0.4) : 1;
    if (alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; e.draw(); ctx.restore(); }
    else e.draw();
  }
  drawGrenades();
  drawBullets();
  drawParticles();
  drawHitMarkers();
  drawDmgIndicators();
  drawSmokes();
  // 烟雾遮罩
  const p = game.ent.players[0];
  if (p) {
    let sa = 0;
    for (const s of game.ent.smokes) {
      if (s.fuse > 0) continue;
      if (Math.hypot(p.x-s.x, p.y-s.y) < s.radius) sa = Math.max(sa, 0.35*(s.life/s.maxLife));
    }
    if (sa > 0) { ctx.fillStyle = `rgba(200,200,200,${sa})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  }
  drawCrosshair();
  drawMinimap();
}

function drawFloor() {
  ctx.fillStyle = '#303238'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const ox = -game.camera.x % 80, oy = -game.camera.y % 80;
  ctx.strokeStyle = 'rgba(255,255,255,0.02)'; ctx.lineWidth = 1;
  for (let x=ox; x<VIEW_W; x+=80) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,VIEW_H); ctx.stroke(); }
  for (let y=oy; y<VIEW_H; y+=80) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(VIEW_W,y); ctx.stroke(); }
  // 血迹
  for (const b of game.ent.bloodstains) {
    const sx=b.x-game.camera.x, sy=b.y-game.camera.y;
    if (sx<-30||sx>VIEW_W+30||sy<-30||sy>VIEW_H+30) continue;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(sx, sy, b.r, 0, Math.PI*2); ctx.fill();
  }
}
function fillWR(wx,wy,ww,wh) {
  const sx=wx-game.camera.x, sy=wy-game.camera.y;
  if (sx+ww<0||sx>VIEW_W||sy+wh<0||sy>VIEW_H) return;
  ctx.fillRect(sx, sy, ww, wh);
}
function roundRect(x,y,w,h,r,fill,stroke) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  if (fill) ctx.fill(); if (stroke) ctx.stroke();
}
function drawCovers() {
  for (const c of game.ent.covers) {
    const sx=c.x-game.camera.x, sy=c.y-game.camera.y;
    if (sx+c.w<-10||sx>VIEW_W+10||sy+c.h<-10||sy>VIEW_H+10) continue;
    if (c.type === 'wall') {
      ctx.fillStyle = c.color; ctx.fillRect(sx, sy, c.w, c.h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(sx, sy, c.w, 4); ctx.fillRect(sx, sy, 4, c.h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(sx+c.w-4, sy, 4, c.h); ctx.fillRect(sx, sy+c.h-4, c.w, 4);
      ctx.fillStyle = 'rgba(180,220,255,0.12)';
      for (let x=sx+24; x<sx+c.w-12; x+=48) for (let y=sy+24; y<sy+c.h-12; y+=48) ctx.fillRect(x, y, 20, 24);
    } else if (c.type === 'car') {
      ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(sx+3, sy+5, c.w, c.h);
      ctx.fillStyle=c.color; roundRect(sx, sy, c.w, c.h, 6, true, false);
      ctx.fillStyle='rgba(30,40,60,0.8)';
      if (c.w>c.h) { for (const xp of [c.w*0.2,c.w*0.5,c.w*0.75]) ctx.fillRect(sx+xp, sy+c.h*0.2, 12, c.h*0.6); }
      else { for (const yp of [c.h*0.15,c.h*0.4,c.h*0.7]) ctx.fillRect(sx+c.w*0.2, sy+yp, c.w*0.6, 12); }
      ctx.fillStyle='#111';
      if (c.w>c.h) { ctx.fillRect(sx+6,sy-3,12,6); ctx.fillRect(sx+c.w-18,sy-3,12,6); ctx.fillRect(sx+6,sy+c.h-3,12,6); ctx.fillRect(sx+c.w-18,sy+c.h-3,12,6); }
      else { ctx.fillRect(sx-3,sy+6,6,12); ctx.fillRect(sx+c.w-3,sy+6,6,12); ctx.fillRect(sx-3,sy+c.h-18,6,12); ctx.fillRect(sx+c.w-3,sy+c.h-18,6,12); }
    } else if (c.type === 'crate') {
      ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(sx+3, sy+4, c.w, c.h);
      ctx.fillStyle=c.color; ctx.fillRect(sx, sy, c.w, c.h);
      ctx.strokeStyle='#5a4a2a'; ctx.lineWidth=2; ctx.strokeRect(sx, sy, c.w, c.h);
      ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+c.w,sy+c.h); ctx.moveTo(sx+c.w,sy); ctx.lineTo(sx,sy+c.h); ctx.stroke();
    }
  }
}
function drawDevices() {
  // 爆炸桶
  for (const b of game.ent.barrels) {
    const sx=b.x-game.camera.x, sy=b.y-game.camera.y;
    if (sx<-30||sx>VIEW_W+30||sy<-30||sy>VIEW_H+30) continue;
    ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(sx, sy+12, 12, 4, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='#c33'; ctx.fillRect(sx-10, sy-14, 20, 26);
    ctx.fillStyle='#811'; ctx.fillRect(sx-10, sy-14, 20, 4);
    ctx.fillStyle='#f80'; ctx.font='bold 8px sans-serif'; ctx.textAlign='center'; ctx.fillText('⚠', sx, sy+2);
  }
  // 互动装置
  for (const d of game.ent.devices) {
    const sx=d.x-game.camera.x, sy=d.y-game.camera.y;
    if (sx<-40||sx>VIEW_W+40||sy<-40||sy>VIEW_H+40) continue;
    const pulse = 0.5 + Math.sin(game.time*0.005)*0.3;
    ctx.save();
    ctx.globalAlpha = 0.3 * pulse;
    if (d.type === 'ammo_crate') { ctx.fillStyle='#fc4'; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI*2); ctx.fill(); }
    else if (d.type === 'first_aid') { ctx.fillStyle='#f44'; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI*2); ctx.fill(); }
    else if (d.type === 'turret') { ctx.fillStyle='#fa4'; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI*2); ctx.fill(); }
    ctx.restore();
    if (d.type === 'ammo_crate') {
      ctx.fillStyle='#334'; ctx.fillRect(sx-14, sy-10, 28, 20);
      ctx.fillStyle='#fc4'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center'; ctx.fillText('📦', sx, sy+4);
    } else if (d.type === 'first_aid') {
      ctx.fillStyle='#fff'; ctx.fillRect(sx-14, sy-14, 28, 28);
      ctx.fillStyle='#f44'; ctx.fillRect(sx-3, sy-10, 6, 20); ctx.fillRect(sx-10, sy-3, 20, 6);
    } else if (d.type === 'turret') {
      ctx.fillStyle='#333'; ctx.fillRect(sx-6, sy-4, 12, 20);
      ctx.fillStyle='#555'; ctx.fillRect(sx-16, sy-2, 32, 6);
      ctx.fillStyle='#777'; ctx.fillRect(sx+12, sy-3, 16, 4);
    }
  }
}
function drawPickups() {
  const icons = {
    medkit:{i:'+',c:'#f44',b:'#fff'}, bandage:{i:'🩹',c:'#fff',b:'#448'},
    armor:{i:'🛡',c:'#48f',b:'#fff'}, energy:{i:'⚡',c:'#f80',b:'#ffc'},
    smoke:{i:'💨',c:'#888',b:'#eee'}, ammo:{i:'📦',c:'#fa4',b:'#fff'},
    weapon_pistol:{i:'🔫',c:'#fc6',b:'#433'}, weapon_rifle:{i:'🎖',c:'#f88',b:'#433'},
    weapon_shotgun:{i:'💥',c:'#fa4',b:'#433'}, weapon_sniper:{i:'🎯',c:'#4af',b:'#433'},
    weapon_smg:{i:'⚡',c:'#8f8',b:'#433'}
  };
  for (const p of game.ent.pickups) {
    const sx=p.x-game.camera.x, sy=p.y-game.camera.y;
    if (sx<-30||sx>VIEW_W+30||sy<-30||sy>VIEW_H+30) continue;
    const cfg = icons[p.type] || {i:'?',c:'#fff',b:'#000'};
    const pulse = 0.5 + Math.sin(game.time*0.005)*0.2;
    ctx.save(); ctx.globalAlpha = 0.3*pulse; ctx.fillStyle = cfg.c;
    ctx.beginPath(); ctx.arc(sx, sy, p.r+6, 0, Math.PI*2); ctx.fill(); ctx.restore();
    ctx.fillStyle = cfg.b; roundRect(sx-p.r, sy-p.r, p.r*2, p.r*2, 5, true, false);
    ctx.strokeStyle = cfg.c; ctx.lineWidth = 2; roundRect(sx-p.r, sy-p.r, p.r*2, p.r*2, 5, false, true);
    ctx.fillStyle = cfg.c; ctx.font='bold 14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(cfg.i, sx, sy+1);
  }
}
function drawBullets() {
  for (const b of game.ent.bullets) {
    const sx=b.x-game.camera.x, sy=b.y-game.camera.y;
    if (sx<-20||sx>VIEW_W+20||sy<-20||sy>VIEW_H+20) continue;
    ctx.save(); ctx.globalAlpha=0.5; ctx.strokeStyle=b.color; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx-b.vx*1.2, sy-b.vy*1.2); ctx.stroke(); ctx.restore();
    ctx.fillStyle=b.color; ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, Math.PI*2); ctx.fill();
  }
}
function drawGrenades() {
  for (const g of game.ent.grenades) {
    const sx=g.x-game.camera.x, sy=g.y-game.camera.y;
    ctx.fillStyle='#333'; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI*2); ctx.fill();
    if (Math.floor(g.fuse/150)%2===0) { ctx.fillStyle='#f44'; ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI*2); ctx.fill(); }
  }
}
function drawExtractionZone() {
  if (game.selectedMode !== 'extraction') return;
  const zone = game.extraction;
  const sx = zone.x - game.camera.x, sy = zone.y - game.camera.y;
  if (sx<-160 || sx>VIEW_W+160 || sy<-160 || sy>VIEW_H+160) return;
  if (zone.active) {
    // 激活：绿色脉动光圈
    const pulse = 0.5 + 0.5 * Math.sin(game.time*0.004);
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.25*pulse;
    ctx.fillStyle = '#4fa';
    ctx.beginPath(); ctx.arc(sx, sy, 120, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#4fa';
    ctx.lineWidth = 3 + 2*pulse;
    ctx.beginPath(); ctx.arc(sx, sy, 120, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#4fa'; ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🚁 撤离点', sx, sy-130);
    // 进度条
    if (zone.entryTimer > 0) {
      const w = 160, pct = clamp(zone.entryTimer/3000, 0, 1);
      ctx.fillStyle = '#000a'; ctx.fillRect(sx-w/2, sy+130, w, 14);
      ctx.fillStyle = '#4fa'; ctx.fillRect(sx-w/2+2, sy+130+2, (w-4)*pct, 10);
      ctx.fillStyle = '#fff'; ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`撤离中 ${(pct*100).toFixed(0)}%`, sx, sy+141);
    }
    ctx.restore();
  } else {
    // 未激活：灰色锁定光圈 + 提示
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#8af';
    ctx.beginPath(); ctx.arc(sx, sy, 120, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#8af'; ctx.setLineDash([8,6]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 120, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#8af'; ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔒 撤离点（未激活）', sx, sy-130);
    const pct = clamp(game.kills / zone.killGoal, 0, 1);
    ctx.fillStyle = '#fff'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`击杀 ${game.kills}/${zone.killGoal}`, sx, sy+130);
    const w = 160;
    ctx.fillStyle = '#000a'; ctx.fillRect(sx-w/2, sy+138, w, 10);
    ctx.fillStyle = '#8af'; ctx.fillRect(sx-w/2+2, sy+138+2, (w-4)*pct, 6);
    ctx.restore();
  }
  // 小地图标记也在 drawMinimap 里另画
}
function drawSmokes() {
  for (const s of game.ent.smokes) {
    if (s.fuse > 0) {
      const sx=s.x-game.camera.x, sy=s.y-game.camera.y;
      ctx.fillStyle='#555'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.fill();
    } else {
      const sx=s.x-game.camera.x, sy=s.y-game.camera.y;
      const life=s.life/s.maxLife, r=s.radius*(1-Math.abs(0.5-life)*0.4), alpha=0.5*Math.min(1,life*3);
      for (let i=0; i<5; i++) {
        const a=i*Math.PI*0.4+game.time*0.0005;
        const ox=Math.cos(a)*r*0.4, oy=Math.sin(a)*r*0.4;
        const grd=ctx.createRadialGradient(sx+ox, sy+oy, 0, sx+ox, sy+oy, r*0.8);
        grd.addColorStop(0,`rgba(210,210,210,${alpha*0.9})`); grd.addColorStop(1,`rgba(180,180,180,0)`);
        ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(sx+ox, sy+oy, r*0.85, 0, Math.PI*2); ctx.fill();
      }
    }
  }
}
function drawParticles() {
  for (const p of game.ent.particles) {
    const sx=p.x-game.camera.x, sy=p.y-game.camera.y;
    const t=p.life/p.maxLife; ctx.globalAlpha=t;
    ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(sx, sy, p.size*t, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
}
function drawHitMarkers() {
  for (const m of game.ent.hitMarkers) {
    const sx=m.x-game.camera.x, sy=m.y-game.camera.y;
    ctx.globalAlpha=m.life/m.maxLife; ctx.fillStyle=m.color;
    ctx.font='bold 14px sans-serif'; ctx.textAlign='center';
    ctx.fillText(m.text, sx, sy);
  }
  ctx.globalAlpha=1;
}
function drawDmgIndicators() {
  if (game.ent.dmgIndicators.length === 0) return;
  const cx=VIEW_W/2, cy=VIEW_H/2, R=Math.min(VIEW_W,VIEW_H)/2-30;
  for (const d of game.ent.dmgIndicators) {
    const a=d.life/d.maxLife;
    ctx.save(); ctx.globalAlpha=a*0.5; ctx.fillStyle='#f44';
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, d.angle-0.25, d.angle+0.25); ctx.closePath(); ctx.fill(); ctx.restore();
  }
}
function drawCrosshair() {
  const mx=game.mouse.x, my=game.mouse.y;
  ctx.save(); ctx.strokeStyle='rgba(255,80,80,0.85)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mx-16,my); ctx.lineTo(mx-5,my); ctx.moveTo(mx+5,my); ctx.lineTo(mx+16,my);
  ctx.moveTo(mx,my-16); ctx.lineTo(mx,my-5); ctx.moveTo(mx,my+5); ctx.lineTo(mx,my+16);
  ctx.stroke(); ctx.fillStyle='#f44'; ctx.fillRect(mx-1, my-1, 2, 2); ctx.restore();
}
function drawMinimap() {
  const mw=miniCanvas.width, mh=miniCanvas.height;
  const sx=mw/game.mapW, sy=mh/game.mapH;
  mctx.fillStyle='#111'; mctx.fillRect(0,0,mw,mh);
  mctx.fillStyle='#555';
  for (const c of game.ent.covers) if (c.type==='wall') mctx.fillRect(c.x*sx, c.y*sy, c.w*sx, c.h*sy);
  mctx.fillStyle='#777';
  for (const c of game.ent.covers) if (c.type==='car') mctx.fillRect(c.x*sx, c.y*sy, Math.max(2,c.w*sx), Math.max(2,c.h*sy));
  mctx.fillStyle='#4f8';
  const drawDot = (e, c) => {
    if (e.hp <= 0) return;
    mctx.fillStyle = c; mctx.beginPath();
    mctx.arc(e.x*sx, e.y*sy, e.downed?1.5:2.5, 0, Math.PI*2); mctx.fill();
  };
  game.ent.players.forEach(p => drawDot(p, '#4af'));
  game.ent.teammates.forEach(t => drawDot(t, '#6cf'));
  game.ent.enemies.forEach(e => drawDot(e, '#f66'));
  game.ent.gangsters.forEach(g => drawDot(g, '#6f6'));
  // 撤离点标记
  if (game.selectedMode === 'extraction') {
    const zx = game.extraction.x*sx, zy = game.extraction.y*sy;
    mctx.save();
    mctx.fillStyle = game.extraction.active ? 'rgba(80,255,160,0.35)' : 'rgba(130,160,255,0.35)';
    mctx.beginPath(); mctx.arc(zx, zy, 6, 0, Math.PI*2); mctx.fill();
    mctx.strokeStyle = game.extraction.active ? '#4fa' : '#8af';
    mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.arc(zx, zy, 6, 0, Math.PI*2); mctx.stroke();
    mctx.fillStyle = '#fff'; mctx.font = 'bold 8px sans-serif'; mctx.textAlign='center';
    mctx.fillText('H', zx, zy+3);
    mctx.restore();
  }
  mctx.strokeStyle='#fff'; mctx.lineWidth=1;
  mctx.strokeRect(game.camera.x*sx, game.camera.y*sy, VIEW_W*sx, VIEW_H*sy);
}

// === HUD ===
// 全局 HUD 节流（~10fps）
let _hudAcc = 0;
function tickHUD(dt) {
  _hudAcc += dt;
  if (_hudAcc >= 100) { _hudAcc = 0; updateHUD(); }
}
function updateHUD() {
  const p = game.ent.players[0]; if (!p) return;
  // HP
  const hpPct = Math.max(0, p.hp/p.maxHp*100);
  document.getElementById('hpFill').style.width = hpPct + '%';
  document.getElementById('hpText').textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
  // 流血指示
  let totalBleed = 0;
  for (const w of p.wounds) totalBleed += w.rate;
  document.getElementById('hpBleed').style.width = Math.min(100, totalBleed*5) + '%';
  document.getElementById('bleedText').style.display = totalBleed > 0 ? 'block' : 'none';
  // 护甲
  document.getElementById('armorFill').style.width = (p.armor/p.maxArmor*100) + '%';
  document.getElementById('armorText').textContent = Math.floor(p.armor);
  // 身体部位图
  for (const part in p.bodyParts) {
    const el = document.getElementById('bp-' + part);
    if (!el) continue;
    const v = p.bodyParts[part];
    el.className = 'bp' + (v < 30 ? ' crit' : v < 60 ? ' warn' : '');
  }
  // 武器
  const wl = document.getElementById('weaponList'); wl.innerHTML = '';
  WEAPON_KEYS.forEach((k, idx) => {
    const el = document.createElement('div');
    el.className = 'w-slot' + (p.weapon.type===k ? ' active' : '') + (!p.ownedWeapons[k] ? ' disabled' : '');
    const w = WEAPONS[k];
    const ammo = p.ownedWeapons[k] ? (p.weapon.type===k ? `${p.weapon.ammo}/${p.ammoReserve[k]}` : `-${p.ammoReserve[k]}`) : '未持有';
    el.innerHTML = `<span class="w-key">${idx+1}</span> ${w.icon} ${w.name} <span style="opacity:0.6">${ammo}</span>`;
    wl.appendChild(el);
  });
  // 分数
  const ae = game.ent.enemies.filter(e => e.hp > 0).length;
  const ag = game.ent.gangsters.filter(g => g.hp > 0).length;
  const at = game.ent.teammates.filter(t => t.hp > 0).length;
  document.getElementById('scoreText').innerHTML = `💀 ${game.kills} | 👥 ${at} | 👹 ${ae} | 🧟 ${ag}`;
  const modeLabel = game.selectedMode === 'extraction' ? '🚁 撤离模式' : '♾️ 无限模式';
  document.getElementById('waveText').textContent = `⚑ ${MAPS[game.selectedMap].name} · ${modeLabel}`;
  document.getElementById('moneyText').textContent = `💰 $${game.money}`;
  // 目标进度条
  const objP = document.getElementById('objectivePanel');
  const objT = document.getElementById('objTitle');
  const objF = document.getElementById('objFill');
  const objH = document.getElementById('objHint');
  if (game.selectedMode === 'extraction') {
    const goal = game.extraction.killGoal;
    const pct = clamp(game.kills / goal, 0, 1);
    objP.style.display = 'block';
    if (!game.extraction.active) {
      objT.textContent = `🎯 目标：击杀 ${game.kills}/${goal} 人以开启撤离点`;
      objF.style.width = (pct*100) + '%';
      objF.style.background = 'linear-gradient(90deg,#4af,#8cf)';
      objH.textContent = '累计击杀达标后，撤离点（蓝色光圈）会自动开启';
    } else {
      objT.textContent = '🚁 前往撤离点（需停留3秒）';
      objF.style.width = clamp(game.extraction.entryTimer/3000,0,1)*100 + '%';
      objF.style.background = 'linear-gradient(90deg,#4fa,#af8)';
      const p = game.ent.players[0];
      if (p) {
        const d = Math.floor(dist(p, game.extraction));
        objH.textContent = game.extraction.entryTimer > 0
          ? `撤离中 ${Math.ceil(game.extraction.entryTimer/1000)}s — 离开光圈会回退！`
          : `距离撤离点 ${d}m，靠近后停留3秒胜利`;
      }
    }
  } else {
    // 无限模式：进度条 = 剩余敌人清零进度（总击杀 / 已累计）
    objP.style.display = 'block';
    const alive = ae + ag;
    const total = alive + game.kills || 1;
    const pct = clamp(game.kills / Math.max(100, total), 0, 1);
    objT.textContent = `🎯 目标：消灭所有敌人（剩余 ${alive}）`;
    objF.style.width = pct*100 + '%';
    objF.style.background = 'linear-gradient(90deg,#f84,#fc6)';
    objH.textContent = '清完敌人即可胜利；每隔18秒会有增援波次';
  }
  // 小队
  const sq = document.getElementById('squadPanel'); sq.innerHTML = '';
  const mk = (dot, name, hp, role='', downed=false, downTimer=0) => {
    const d = document.createElement('div'); d.className = 'squad-m';
    const roleTag = role ? `<span style="font-size:9px;opacity:.7;margin-left:3px">[${role}]</span>` : '';
    const hpTag = downed
      ? `<span style="color:#f80">倒地 ${Math.max(0, Math.ceil(downTimer/1000))}s</span>`
      : `<span style="opacity:0.6">${hp}%</span>`;
    d.innerHTML = `<div class="squad-dot" style="background:${dot}"></div>${name}${roleTag} ${hpTag}`;
    sq.appendChild(d);
  };
  mk('#4af', '你', Math.max(0, Math.round(p.hp/p.maxHp*100)), '', p.downed, p.downTimer);
  for (const t of game.ent.teammates) {
    const dead = t.hp<=0 && t.downed && t.downTimer<=0;
    const color = dead ? '#444' : (t.downed ? '#f80' : '#6cf');
    const hpVal = t.hp > 0 ? Math.round(t.hp/t.maxHp*100) : 0;
    mk(color, t.nameTag, hpVal, t.role || '', t.downed, t.downTimer);
  }
  // 道具
  const ib = document.getElementById('itemsPanel'); ib.innerHTML = '';
  const addItem = (key, icon, name, count) => {
    const d = document.createElement('div'); d.className = 'item-slot';
    d.innerHTML = `<span class="item-key">${key}</span> ${icon} ${name} <span class="item-count">x${count}</span>`;
    ib.appendChild(d);
  };
  addItem('Q','💊','医疗包', p.items.medkit);
  addItem('B','🩹','绷带', p.items.bandage);
  addItem('E','🛡','防弹衣', p.items.armor);
  addItem('F','🥤','能量饮料', p.items.energy);
  addItem('G','💨','烟雾弹', p.items.smoke);
  // 闪避充能
  const ds = document.getElementById('dodgeSlots');
  if (ds) {
    ds.innerHTML = '';
    for (let i=0; i<p.maxDodgeCharges; i++) {
      const slot = document.createElement('div');
      const filled = i < p.dodgeCharges;
      slot.style.cssText = `width:18px;height:18px;border-radius:4px;border:1px solid rgba(80,200,255,0.4);background:${filled?'rgba(80,200,255,0.6)':'rgba(20,40,60,0.3)'};display:flex;align-items:center;justify-content:center;font-size:11px`;
      slot.textContent = filled ? '💨' : '';
      ds.appendChild(slot);
    }
  }
}

function flashDamage() {
  const f = document.getElementById('dmgFlash');
  f.style.boxShadow = 'inset 0 0 80px rgba(255,0,0,0.4)';
  setTimeout(() => { f.style.boxShadow = 'inset 0 0 0 rgba(255,0,0,0)'; }, 200);
}

function showDownedOverlay() {
  document.getElementById('downedOverlay').style.display = 'flex';
  logMsg('💀 你倒下了！等待队友救援或按Q自救', '#f44');
}
function hideDownedOverlay() {
  document.getElementById('downedOverlay').style.display = 'none';
}

// === 主循环 ===
let lastT = 0;
function loop(t) {
  const dt = Math.min(40, t - lastT || 16.67);
  lastT = t;
  if (game.running && !game.over) {
    game.time += dt;
    tick(dt);
  }
  render();
  requestAnimationFrame(loop);
}

function tick(dt) {
  const p = game.ent.players[0];
  if (p) {
    const tx = clamp(p.x - VIEW_W/2, 0, game.mapW - VIEW_W);
    const ty = clamp(p.y - VIEW_H/2, 0, game.mapH - VIEW_H);
    game.camera.x = lerp(game.camera.x, tx, 0.1);
    game.camera.y = lerp(game.camera.y, ty, 0.1);
    game.mouse.worldX = game.mouse.x + game.camera.x;
    game.mouse.worldY = game.mouse.y + game.camera.y;
  }
  game.ent.players.forEach(e => e.update(dt));
  game.ent.teammates.forEach(e => e.update(dt));
  game.ent.enemies.forEach(e => e.update(dt));
  game.ent.gangsters.forEach(e => e.update(dt));
  updateBullets(dt);
  updateGrenades(dt);
  updateSmokes(dt);
  updateParticles(dt);
  updatePickups();
  processDeaths();
  // 撤离模式：有限增援3波，达到击杀目标开启撤离点
  if (game.selectedMode === 'extraction') {
    updateReinforcements();
    // 达到击杀目标 → 开启撤离点
    if (!game.extraction.active && game.kills >= game.extraction.killGoal) {
      game.extraction.active = true;
      logMsg('🚁 撤离点已开启！前往蓝色光圈撤离（需停留3秒）', '#4fa');
    }
    // 进入撤离点计时
    if (game.extraction.active && game.ent.players[0]) {
      const p = game.ent.players[0];
      if (dist(p, game.extraction) < 120) {
        game.extraction.entryTimer += dt;
        if (game.extraction.entryTimer >= 3000 && !game.over) {
          endGame(true, '撤离成功！');
        }
      } else {
        game.extraction.entryTimer = Math.max(0, game.extraction.entryTimer - dt * 1.5);
      }
    }
  } else {
    // 无限模式：正常无限增援
    updateReinforcements();
    // 胜利：击杀完所有敌人
    const te = game.ent.enemies.filter(e => e.hp > 0).length;
    const tg = game.ent.gangsters.filter(g => g.hp > 0).length;
    if (te === 0 && tg === 0 && game.kills > 0 && !game.over) endGame(true);
  }
  tickHUD(dt);
}

// === 游戏结束 ===
function endGame(won, titleExtra='') {
  game.over = true; game.running = false;
  document.getElementById('gameOverScreen').style.display = 'flex';
  const titleTxt = won ? ('🏆 胜利！' + (titleExtra ? ' '+titleExtra : '')) : '💀 任务失败';
  document.getElementById('goTitle').textContent = titleTxt;
  document.getElementById('goTitle').style.color = won ? '#4fa' : '#f44';
  const at = game.ent.teammates.filter(t => t.hp > 0).length;
  document.getElementById('goStats').innerHTML =
    `击杀: <b>${game.kills}</b> | 存活队友: <b>${at}</b><br>金钱: <b>$${game.money}</b> | 时长: <b>${(game.time/1000).toFixed(1)}秒</b>`;
}

// === 输入 ===
window.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  game.keys[key] = true;
  if (!game.running || game.over) return;
  const p = game.ent.players[0]; if (!p) return;
  if (key === 'r') p.reload();
  if (key === 'q') { if (!p.useItem('medkit')) logMsg('没有医疗包了！','#f66'); else logMsg('使用医疗包 +60HP (止血)','#4f8'); }
  if (key === 'b') { if (!p.useItem('bandage')) logMsg('没有绷带或未流血！','#f66'); else logMsg('包扎止血！','#fff'); }
  if (key === 'e') p.interact();
  if (key === 'f') { if (!p.useItem('energy')) logMsg('没有能量饮料！','#f66'); else logMsg('饮下能量饮料，加速+回血！','#fc4'); }
  if (key === 'g') { if (!p.useItem('smoke')) logMsg('没有烟雾弹！','#f66'); else logMsg('投掷烟雾弹！','#ccc'); }
  if (key >= '1' && key <= '5') {
    const wk = WEAPON_KEYS[parseInt(key)-1];
    if (p.switchWeapon(wk)) logMsg(`切换到 ${WEAPONS[wk].name}`, WEAPONS[wk].color);
    else if (!p.ownedWeapons[wk]) logMsg(`未持有 ${WEAPONS[wk].name}`, '#f66');
  }
  if (key === ' ' && p.rolling <= 0 && p.stamina > 10) {
    let dx=0, dy=0;
    if (game.keys['w']) dy--; if (game.keys['s']) dy++;
    if (game.keys['a']) dx--; if (game.keys['d']) dx++;
    const l = Math.hypot(dx,dy);
    if (l > 0) { dx/=l; dy/=l; } else { dx=Math.cos(p.angle); dy=Math.sin(p.angle); }
    p.rolling = 260; p.rollDir = {x:dx, y:dy}; p.stamina -= 10;
    logMsg('💨 翻滚闪避！', '#4cf');
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => { game.keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  game.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
  game.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
});
canvas.addEventListener('mousedown', e => { if (e.button === 0) game.mouse.down = true; });
window.addEventListener('mouseup', e => { if (e.button === 0) game.mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// === 选择界面 ===
function initStartScreen() {
  // 地图卡片
  const mg = document.getElementById('mapGrid');
  for (const key in MAPS) {
    const m = MAPS[key];
    const card = document.createElement('div');
    card.className = 'map-card' + (key === game.selectedMap ? ' selected' : '');
    card.dataset.map = key;
    card.innerHTML = `<div class="card-icon">${m.icon}</div><div class="card-name">${m.name}</div><div class="card-desc">${m.desc}</div><div class="card-info">${m.info}</div>`;
    card.onclick = () => selectMap(key);
    mg.appendChild(card);
  }
  // 武器卡片
  const wg = document.getElementById('weaponGrid');
  WEAPON_KEYS.forEach(key => {
    const w = WEAPONS[key];
    const card = document.createElement('div');
    card.className = 'weapon-card' + (key === game.selectedWeapon ? ' selected' : '');
    card.dataset.weapon = key;
    const statBar = (label, val, max) => `<div class="stat-row"><div class="stat-label">${label}</div><div class="stat-bar"><div class="stat-fill" style="width:${val/max*100}%"></div></div></div>`;
    card.innerHTML = `<div class="card-icon">${w.icon}</div><div class="card-name">${w.name}</div>` +
      statBar('伤害', w.stats.dmg, 5) + statBar('射速', w.stats.rate, 5) +
      statBar('弹匣', w.stats.mag, 5) + statBar('射程', w.stats.range, 5);
    card.onclick = () => selectWeapon(key);
    wg.appendChild(card);
  });
  // 模式卡片
  const modg = document.getElementById('modeGrid');
  for (const key in MODES) {
    const m = MODES[key];
    const card = document.createElement('div');
    card.className = 'map-card' + (key === game.selectedMode ? ' selected' : '');
    card.dataset.mode = key;
    card.innerHTML = `<div class="card-icon">${m.icon}</div><div class="card-name">${m.name}</div><div class="card-desc">${m.desc}</div><div class="card-info">${m.info}</div>`;
    card.onclick = () => selectMode(key);
    modg.appendChild(card);
  }
}
function selectMap(key) {
  game.selectedMap = key;
  document.querySelectorAll('.map-card').forEach(c => c.classList.toggle('selected', c.dataset.map === key));
}
function selectWeapon(key) {
  game.selectedWeapon = key;
  document.querySelectorAll('.weapon-card').forEach(c => c.classList.toggle('selected', c.dataset.weapon === key));
}
function selectMode(key) {
  game.selectedMode = key;
  document.querySelectorAll('#modeGrid .map-card').forEach(c => c.classList.toggle('selected', c.dataset.mode === key));
}

// === 启动 ===
function startGame() {
  document.getElementById('startScreen').style.display = 'none';
  initGame();
  game.running = true;
  logMsg(`⚑ 任务开始：${MAPS[game.selectedMap].name}`, '#4af');
  logMsg('提示：击中不同身体部位有不同效果！头/心=2倍流血', '#fc6');
  logMsg('E键可以使用急救站、操作机枪、开启弹药箱', '#4f8');
}

initStartScreen();
requestAnimationFrame(loop);
