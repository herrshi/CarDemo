require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/layers/TileLayer",
  "esri/views/3d/externalRenderers",
  "esri/geometry/SpatialReference",
  "js/coordtransform.js"
], function(
  Map,
  SceneView,
  TileLayer,
  externalRenderers,
  SpatialReference,
  coordtransform
) {
  const map = new Map({
    basemap: {
      baseLayers: [
        new TileLayer({
          url:
            "https://map.geoq.cn/arcgis/rest/services/ChinaOnlineCommunity/MapServer"
        })
      ]
    }
  });

  const view = new SceneView({
    container: "viewDiv",
    map: map,
    viewingMode: "local",
    camera: {
      heading: 0,
      tilt: 70,
      position: {
        latitude: 39.569704,
        longitude: 116.433877,
        z: 13000
      }
    }
  });
  view.environment.lighting.cameraTrackingEnabled = false;

  const issExternalRenderer = {
    renderer: null,
    camera: null,
    scene: null,

    ambient: null,
    sun: null,

    car: null,
    carScale: 100,
    carHeight: 50,
    carMaterial: new THREE.MeshLambertMaterial({ color: 0x6ca8f3 }),
    carFocusMaterial: new THREE.MeshLambertMaterial({ color: 0xe03110 }),

    cameraPositionInitialized: false,
    //轨迹点列表
    positionHistory: [],
    //以经过的点列表
    estHistory: [],

    region: null,

    rayCaster: null,

    //camera是否追踪车辆
    cameraTracing: true,

    setup: function(context) {
      this.renderer = new THREE.WebGLRenderer({
        context: context.gl,
        premultipliedAlpha: false
      });
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setViewport(0, 0, view.width, view.height);

      this.renderer.autoClearDepth = false;
      this.renderer.autoClearStencil = false;
      this.renderer.autoClearColor = false;

      const originalSetRenderTarget = this.renderer.setRenderTarget.bind(
        this.renderer
      );
      this.renderer.setRenderTarget = function(target) {
        originalSetRenderTarget(target);
        if (target == null) {
          context.bindRenderTarget();
        }
      };

      this.scene = new THREE.Scene();

      // setup the camera
      this.camera = new THREE.PerspectiveCamera();

      // setup scene lighting
      this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
      this.scene.add(this.ambient);
      this.sun = new THREE.DirectionalLight(0xffffff, 0.5);
      this.scene.add(this.sun);

      //载入车辆模型
      const carMeshUrl = "assets/Porsche_911_GT2.obj";
      const loader = new THREE.OBJLoader(THREE.DefaultLoadingManager);
      loader.load(
        carMeshUrl,
        object3d => {
          console.log("Car mesh loaded.");
          this.car = object3d;
          //车辆水平放置
          this.car.rotateX(Math.PI / 2);

          this.car.traverse(child => {
            if (child instanceof THREE.Mesh) {
              child.material = this.carMaterial;
            }
          });
          this.car.scale.set(this.carScale, this.carScale, this.carScale);

          this.scene.add(this.car);
        },
        undefined,
        error => {
          console.error("Error loading Car mesh. ", error);
        }
      );

      const mat = new THREE.MeshBasicMaterial({ color: 0x2194ce });
      mat.transparent = true;
      mat.opacity = 0.5;
      this.region = new THREE.Mesh(
        new THREE.TorusBufferGeometry(500, 25, 16, 64),
        mat
      );
      this.scene.add(this.region);

      this.loadCarTrack().then(() => {
        this.queryCarPosition();
      });

      //点击事件
      this.rayCaster = new THREE.Raycaster();
      view.container.addEventListener("click", event => {
        const mouse = new THREE.Vector2();
        mouse.x = event.clientX / window.innerWidth * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.rayCaster.setFromCamera(mouse, this.camera);
        const intersects = this.rayCaster.intersectObjects(
          this.scene.children,
          true
        );
        if (intersects.length >= 1) {
          const intersect = intersects[0].object;

          if (intersect.parent && intersect.parent instanceof THREE.Group) {
            this.cameraTracing = !this.cameraTracing;
            if (!this.cameraTracing) {
              view.goTo({
                zoom: 13,
                tilt: 0
              });
              this.car.traverse(child => {
                if (child instanceof THREE.Mesh) {
                  child.material = this.carFocusMaterial;
                }
              });
              this.car.scale.set(
                this.carScale * 2,
                this.carScale * 2,
                this.carScale * 2
              );
            } else {
              view.goTo({
                zoom: 16,
                tilt: 70
              });
              this.car.traverse(child => {
                if (child instanceof THREE.Mesh) {
                  child.material = this.carMaterial;
                }
              });
              this.car.scale.set(this.carScale, this.carScale, this.carScale);
            }
          }
        }
      });
      context.resetWebGLState();
    },

    render: function(context) {
      const cam = context.camera;

      this.camera.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
      this.camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
      this.camera.lookAt(new THREE.Vector3(...cam.center));

      if (this.car) {
        let { pos: posEst, angel: angelEst } = this.computeCarPosition();
        // posEst[2] = 10;

        let renderPos = [0, 0, 0];
        externalRenderers.toRenderCoordinates(
          view,
          posEst,
          0,
          SpatialReference.WGS84,
          renderPos,
          0,
          1
        );
        this.car.position.set(...renderPos);
        this.car.rotation.y = -angelEst;

        // posEst = [posEst[0], posEst[1], ];
        const transform = new THREE.Matrix4();
        transform.fromArray(
          externalRenderers.renderCoordinateTransformAt(
            view,
            posEst,
            SpatialReference.WGS84,
            new Array(16)
          )
        );
        transform.decompose(
          this.region.position,
          this.region.quaternion,
          this.region.scale
        );

        if (
          this.estHistory.length > 0 &&
          (!this.cameraPositionInitialized || this.cameraTracing)
        ) {
          this.cameraPositionInitialized = true;
          view.goTo({
            target: [posEst[0], posEst[1]],
            zoom: this.cameraTracing ? 16 : 13,
            tilt: this.cameraTracing ? 70 : 0
          });
        }
      }

      // Projection matrix can be copied directly
      this.camera.projectionMatrix.fromArray(cam.projectionMatrix);

      if (this.estHistory.length > 0) {
        view.environment.lighting.date = new Date(
          this.estHistory[this.estHistory.length - 1].time * 1000
        );
      }

      const l = context.sunLight;
      this.sun.position.set(l.direction[0], l.direction[1], l.direction[2]);
      this.sun.intensity = l.diffuse.intensity;
      this.sun.color = new THREE.Color(
        l.diffuse.color[0],
        l.diffuse.color[1],
        l.diffuse.color[2]
      );

      this.ambient.intensity = l.ambient.intensity;
      this.ambient.color = new THREE.Color(
        l.ambient.color[0],
        l.ambient.color[1],
        l.ambient.color[2]
      );
      this.renderer.resetGLState();
      this.renderer.render(this.scene, this.camera);
      externalRenderers.requestRender(view);
      context.resetWebGLState();
    },

    timeOffset: 0,

    loadCarTrack: function() {
      return new Promise((resolve, reject) => {
        console.time("Car history loaded");
        fetch("data/10.txt")
          .then(response => {
            return response.text();
          })
          .then(data => {
            const dataList = data.split(/[\n\r]+/);
            // this.timeOffset = Date.now() - new Date(dataList[0].split(",")[1]).getTime();
            dataList.forEach((positionInfo, index) => {
              const posInfoData = positionInfo.split(",");
              const time = new Date(posInfoData[1]).getTime();
              if (index === 0) {
                this.timeOffset = Math.round((Date.now() - time) / 1000);
                console.log(this.timeOffset);
              }
              const pos = coordtransform.wgs84togcj02(
                Number(posInfoData[2]),
                Number(posInfoData[3])
              );
              this.positionHistory.push({
                pos: pos,
                time: time / 1000
              });
            });
            this.estHistory.push({
              pos: [...this.positionHistory[0].pos, this.carHeight],
              time: this.positionHistory[0].time,
              vel: [0, 0]
            });
            this.currentPointIndex = 1;
            resolve();
            console.timeEnd("Car history loaded");
          });
      });
    },

    currentPointIndex: 0,
    // nextTime: 0,

    queryCarPosition: function() {
      let vel = [0, 0];
      const current = this.positionHistory[this.currentPointIndex];
      const next = this.positionHistory[this.currentPointIndex + 1];
      const nextTime = next.time - current.time;

      if (this.estHistory.length > 0) {
        const last = this.positionHistory[this.currentPointIndex - 1];
        const deltaT = current.time - last.time;
        const vLon = (current.pos[0] - last.pos[0]) / deltaT;
        const vLat = (current.pos[1] - last.pos[1]) / deltaT;
        vel = [vLon, vLat];
      }

      this.estHistory.push({
        pos: [...current.pos, this.carHeight],
        time: current.time,
        vel: vel
      });
      this.currentPointIndex++;
      console.log(this.currentPointIndex, ...vel);

      setTimeout(() => {
        this.queryCarPosition();
      }, nextTime * 1000);
    },

    lastPosition: null,
    lastTime: null,

    computeCarPosition: function() {
      if (this.estHistory.length === 0) {
        return [0, 0, 0];
      }

      if (this.estHistory.length === 1) {
        return this.estHistory[0].pos;
      }

      const now = Date.now() / 1000 - this.timeOffset;
      // console.log(now);
      const entry1 = this.estHistory[this.estHistory.length - 1];

      if (!this.lastPosition) {
        this.lastPosition = entry1.pos;
        this.lastTime = entry1.time;
      }

      // compute a new estimated position
      const dt1 = now - entry1.time;
      const est1 = [
        entry1.pos[0] + dt1 * entry1.vel[0],
        entry1.pos[1] + dt1 * entry1.vel[1]
      ];

      // compute the delta of current and newly estimated position
      const dPos = [
        est1[0] - this.lastPosition[0],
        est1[1] - this.lastPosition[1]
      ];

      // compute required velocity to reach newly estimated position
      // but cap the actual velocity to 1.2 times the currently estimated ISS velocity
      let dt = now - this.lastTime;
      if (dt === 0) {
        dt = 1.0 / 1000;
      }

      const catchupVel = Math.sqrt(dPos[0] * dPos[0] + dPos[1] * dPos[1]) / dt;
      const maxVel =
        1.2 *
        Math.sqrt(
          entry1.vel[0] * entry1.vel[0] + entry1.vel[1] * entry1.vel[1]
        );
      const factor = catchupVel <= maxVel ? 1.0 : maxVel / catchupVel;

      // move the current position towards the estimated position
      const newPos = [
        this.lastPosition[0] + dPos[0] * factor,
        this.lastPosition[1] + dPos[1] * factor,
        entry1.pos[2]
      ];

      this.lastPosition = newPos;
      this.lastTime = now;

      return { pos: newPos, angel: Math.atan2(entry1.vel[0], entry1.vel[1]) };
    }
  };

  externalRenderers.add(view, issExternalRenderer);
});
