require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/layers/TileLayer",
  "esri/views/3d/externalRenderers",
  "esri/geometry/SpatialReference"
], function(Map, SceneView, TileLayer, externalRenderers, SpatialReference) {
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
    carMaterial: new THREE.MeshLambertMaterial({ color: 0xe03110 }),

    cameraPositionInitialized: false,
    //轨迹点列表
    positionHistory: [],
    //以经过的点列表
    estHistory: [],

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

      const carMeshUrl = "assets/Porsche_911_GT2.obj";
      const loader = new THREE.OBJLoader(THREE.DefaultLoadingManager);
      loader.load(
        carMeshUrl,
        object3d => {
          console.log("Car mesh loaded.");
          this.car = object3d;
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

      this.loadCarTrack().then(() => {
        this.queryCarPosition();
      });
      context.resetWebGLState();
    },

    render: function(context) {
      const cam = context.camera;

      this.camera.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
      this.camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
      this.camera.lookAt(
        new THREE.Vector3(cam.center[0], cam.center[1], cam.center[2])
      );

      if (this.car) {
        let posEst = this.computeCarPosition();
        posEst[2] = 10;

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
        this.car.position.set(renderPos[0], renderPos[1], renderPos[2]);
      }

      // Projection matrix can be copied directly
      this.camera.projectionMatrix.fromArray(cam.projectionMatrix);

      view.environment.lighting.date = new Date(
        this.estHistory[this.estHistory.length - 1].time * 1000
      );
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

    loadCarTrack: function() {
      return new Promise((resolve, reject) => {
        console.time("Car history loaded");
        fetch("data/10.txt")
          .then(response => {
            return response.text();
          })
          .then(data => {
            const dataList = data.split(/[\n\r]+/);
            //将所有时间转换为从当前时间开始，模拟实时数据
            // const timeInterval = Date.now() - new Date(dataList[0].split(",")[1]).getTime();
            // console.log(timeInterval);
            dataList.forEach((positionInfo, index) => {
              const posInfoData = positionInfo.split(",");
              const time = new Date(posInfoData[1]).getTime();
              this.positionHistory.push({
                pos: [posInfoData[2], posInfoData[3]],
                time: time / 1000
              });
            });
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
        pos: [...current.pos, 10],
        time: current.time,
        vel: vel
      });
      this.currentPointIndex++;
      console.log(new Date().toTimeString(), this.estHistory);

      setTimeout(() => {
        this.queryCarPosition();
      }, nextTime * 1000);
    },

    computeCarPosition: function() {
      if (this.estHistory.length === 0) {
        return [0, 0, 0];
      }

      if (this.estHistory.length === 1) {
        return this.estHistory[0].pos;
      }
    }
  };

  externalRenderers.add(view, issExternalRenderer);
});
