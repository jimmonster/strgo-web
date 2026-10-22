

export const CATS = [
  { id:'milk', name:'Milk', zh:'奶油长毛家猫', typeId:'domestic', type:'田园与混合家猫', coat:'long', color:'#fff7ef', soft:'#ffd7e8', ink:'#8c2853', eyes:'#5d3a7a', pattern:'cream', build:'round-long', personality:'Sweet & Gentle', bio:'一只会用慢眨眼回应你的奶油色长毛家猫。Milk 喜欢柔软毛毯、粉色蝴蝶结和安静的陪伴。', actions:['pet','paw','wave'], preset:'gentle', tags:['长毛','奶白','粉蝴蝶结'] },
  { id:'mocha', name:'Mocha', zh:'美国短毛猫', typeId:'american-shorthair', type:'美国短毛猫', coat:'short', color:'#c98354', soft:'#ffe1c8', ink:'#6f3544', eyes:'#a66c2b', pattern:'orange-tabby', build:'natural-short', personality:'Playful & Curious', bio:'橘白虎斑 Mocha 总能找到新的玩具。它的动作轻快，喜欢挥爪和扑向会滚动的小鱼。', actions:['play','wave','stretch'], preset:'playful', tags:['短毛','虎斑','小帽衫'] },
  { id:'boba', name:'Boba', zh:'英国短毛猫', typeId:'british-shorthair', type:'英国短毛猫', coat:'short', color:'#bfc4cf', soft:'#e4e7ef', ink:'#4e5872', eyes:'#7ba4a1', pattern:'silver-white', build:'round-short', personality:'Lazy & Adorable', bio:'圆脸银灰 Boba 把午睡变成一项艺术。翻身、伸懒腰，再露出一小块柔软的爪垫。', actions:['sleep','stretch','paw'], preset:'lazy', tags:['短毛','圆脸','银灰'] },
  { id:'peach', name:'Peach', zh:'异国短毛猫', typeId:'exotic-shorthair', type:'异国短毛猫', coat:'short', color:'#f4bf8e', soft:'#ffe9c8', ink:'#814f50', eyes:'#7e9a89', pattern:'cream-white', build:'round-flat', personality:'Charming & Silly', bio:'Peach 有一张短口鼻圆脸，总在踩奶时把自己逗笑。它喜欢帽兜、软垫和慢慢歪头。', actions:['knead','pet','play'], preset:'knead', tags:['短毛','短口鼻','奶油橘'] },
  { id:'luna', name:'Luna', zh:'布偶猫', typeId:'ragdoll', type:'布偶猫', coat:'semi-long', color:'#e9d6cf', soft:'#e9e3ff', ink:'#7d5a67', eyes:'#75a8d4', pattern:'blue-bicolor-point', build:'ragdoll-long', personality:'Calm & Dreamy', bio:'蓝色重点色的 Luna 用蓬松尾巴写下慢悠悠的节拍。它喜欢云朵、蝴蝶结和被轻轻碰爪。', actions:['paw','pet','wave'], preset:'gentle-tail', tags:['半长毛','蓝眼','重点色'] },
  { id:'atlas', name:'Atlas', zh:'缅因猫', typeId:'maine-coon', type:'缅因猫', coat:'long', color:'#8b604d', soft:'#e9d6c9', ink:'#4b3030', eyes:'#8da56e', pattern:'brown-tabby-white', build:'large-long', personality:'Brave & Warm', bio:'Atlas 是队伍里的大步行者，方形口鼻、耳簇和宽爪让它看起来可靠又温柔。', actions:['walk','paw','stretch'], preset:'big-step', tags:['长毛','大型','耳簇'] },
  { id:'pearl', name:'Pearl', zh:'波斯猫', typeId:'persian', type:'波斯猫', coat:'long', color:'#e6e4e7', soft:'#f2eef2', ink:'#6c6370', eyes:'#83a0af', pattern:'silver-white', build:'round-long', personality:'Elegant & Quiet', bio:'银白披毛的 Pearl 喜欢在窗边整理自己的毛发。圆头、低重心和蓬松披毛是它的标志。', actions:['pet','sleep','stretch'], preset:'groom', tags:['长毛','圆头','低重心'] },
  { id:'milo', name:'Milo', zh:'暹罗猫', typeId:'siamese', type:'暹罗猫', coat:'short', color:'#e8d0b6', soft:'#efe1d8', ink:'#553b3e', eyes:'#5b84bc', pattern:'seal-point', build:'slender-wedge', personality:'Bright & Nimble', bio:'海豹重点色 Milo 拥有修长身形和大耳朵。它追视很快，转身像一阵轻轻的风。', actions:['look','wave','play'], preset:'nimble', tags:['短毛','修长','蓝眼'] },
  { id:'tiger', name:'Tiger', zh:'孟加拉猫', typeId:'bengal', type:'孟加拉猫', coat:'short', color:'#c88a4a', soft:'#ffe0b9', ink:'#543b2d', eyes:'#a6a855', pattern:'rosette', build:'athletic-spotted', personality:'Bold & Energetic', bio:'玫瑰斑孟加拉 Tiger 随时准备扑向下一颗毛线球。低身、弹跳和尾巴路线都充满运动感。', actions:['play','stretch','wave'], preset:'pounce', tags:['短毛','玫瑰斑','运动型'] },
  { id:'misty', name:'Misty', zh:'俄罗斯蓝猫', typeId:'russian-blue', type:'俄罗斯蓝猫', coat:'short', color:'#7d8e9e', soft:'#dce7f0', ink:'#3c4b5c', eyes:'#8db176', pattern:'blue-solid', build:'slender-blue', personality:'Soft & Observant', bio:'蓝灰短密毛和绿眼睛让 Misty 像一缕安静的薄雾。它喜欢侧身转头，再坐回光里。', actions:['look','pet','paw'], preset:'observant', tags:['短毛','蓝灰','绿眼'] },
  { id:'fern', name:'Fern', zh:'挪威森林猫', typeId:'norwegian-forest', type:'挪威森林猫', coat:'long', color:'#9c755e', soft:'#ebd7c9', ink:'#543e3a', eyes:'#a7ad70', pattern:'brown-white', build:'triangular-forest', personality:'Steady & Kind', bio:'Fern 有三角脸、厚实毛领和长尾巴。它的慢走像森林里的风，尾巴会扫过柔软的云。', actions:['walk','pet','stretch'], preset:'forest-walk', tags:['长毛','毛领','三角脸'] },
  { id:'suki', name:'Suki', zh:'斯芬克斯猫', typeId:'sphynx', type:'斯芬克斯猫', coat:'hairless', color:'#d99d91', soft:'#f4d7cf', ink:'#704047', eyes:'#8aafae', pattern:'warm-skin', build:'hairless', personality:'Warm & Expressive', bio:'Suki 用温暖的皮肤、褶皱和大耳朵表达情绪。它喜欢探头、抬爪，也喜欢靠近你。', actions:['look','paw','wave'], preset:'sphynx', tags:['近乎无毛','褶皱','大耳'] },
  { id:'sunny', name:'Sunny', zh:'橘色家猫', typeId:'domestic', type:'田园与混合家猫', coat:'short', color:'#e79b3a', soft:'#ffe0a7', ink:'#704028', eyes:'#a98a51', pattern:'orange-tabby', build:'natural-short', personality:'Warm & Sleepy', bio:'Sunny 把晒太阳当成日程表。它会打哈欠、眯起眼，再在云朵上恢复睡姿。', actions:['sleep','stretch','pet'], preset:'sunny', tags:['短毛','橘虎斑','晒太阳'] },
  { id:'clover', name:'Clover', zh:'三花家猫', typeId:'domestic', type:'田园与混合家猫', coat:'short', color:'#d7885f', soft:'#f5d5cf', ink:'#5f3c44', eyes:'#72977c', pattern:'calico', build:'natural-short', personality:'Cheerful & Quick', bio:'黑橘白三花 Clover 会绕着玩具轻跳一圈，再回头看看你有没有跟上。', actions:['play','wave','stretch'], preset:'quick', tags:['短毛','三花','轻跳'] }
];

export const TYPE_LABELS = { all:'全部', short:'短毛', long:'长毛', hairless:'近乎无毛', domestic:'家猫', 'british-shorthair':'英短', 'american-shorthair':'美短', ragdoll:'布偶', 'maine-coon':'缅因', persian:'波斯', 'exotic-shorthair':'异短', siamese:'暹罗', bengal:'孟加拉', 'russian-blue':'俄罗斯蓝', 'norwegian-forest':'挪威森林', sphynx:'斯芬克斯' };
export const GALLERIES = [
  { id:'bubble-wave', title:'Bubble Wave', subtitle:'Boba in a bubble bath', catId:'boba', copy:'Boba 在泡泡中挥爪，透明泡泡会随相机轻轻闪光。', one:'#f9b5d0', two:'#c9d9f5' },
  { id:'hoodie-peek', title:'Hoodie Peek', subtitle:'Peach says hello', catId:'peach', copy:'Peach 从粉色帽兜探头，可切换探头与歪头。', one:'#ffc6d9', two:'#f4d3b1' },
  { id:'cozy-roll', title:'Cozy Roll', subtitle:'Milk on the soft blanket', catId:'milk', copy:'Milk 躺在软毯上翻身，爪垫可近距离观察。', one:'#ffd8e7', two:'#f6c2d7' },
  { id:'paw-party', title:'Paw Party', subtitle:'Luna reaches the sky', catId:'luna', copy:'Luna 的前爪与身体构成近景，能碰爪和拉远。', one:'#d7d4f8', two:'#f8c4db' },
  { id:'cloud-nap', title:'Cloud Nap', subtitle:'Sunny sleeps above the clouds', catId:'sunny', copy:'Sunny 在云朵上睡觉，可轻柔唤醒和恢复睡姿。', one:'#d2e7fa', two:'#ffe0ef' }
];
export const PRODUCTS = [
  { id:'cloud-bed', title:'云朵猫窝', category:'beds', art:'☁️', copy:'给长长的午睡留一朵柔软的云。', options:['小号','中号','大号'] },
  { id:'paw-mug', title:'肉垫杯', category:'more', art:'☕', copy:'每一口都像被小爪垫碰过。', options:['奶油白','草莓粉','云雾灰'] },
  { id:'bow-tote', title:'蝴蝶结包', category:'toys-accessories', art:'👜', copy:'把喜欢的东西装进一只轻盈的蝴蝶结包。', options:['粉色','奶油黄','莓果红'] },
  { id:'fish-toy', title:'小鱼玩具', category:'toys-accessories', art:'🐟', copy:'轻轻一拍，就开始一段追逐游戏。', options:['蓝鱼','粉鱼'] },
  { id:'yarn-ball', title:'毛线球', category:'toys-accessories', art:'🧶', copy:'可以换颜色，也可以看它慢慢滚起来。', options:['樱桃粉','抹茶绿','奶茶棕'] },
  { id:'bow-hoodie', title:'粉色猫帽衫', category:'apparel', art:'🧥', copy:'给适合的猫咪预览一件柔软帽衫。', options:['S','M','L'] },
  { id:'mini-cat', title:'猫咪小摆件', category:'more', art:'🐈', copy:'把一个小小的 Meow 角色放在桌边。', options:['Milk','Luna','Suki'] }
];
export const CATEGORY_LABELS = { beds:'Cat Beds', 'toys-accessories':'Toys & Accessories', apparel:'Cute Apparel', more:'More Meow Magic!' };

